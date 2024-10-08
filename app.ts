import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import FormData from 'form-data';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import AWS from 'aws-sdk';
import ffmpeg from 'fluent-ffmpeg';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

dotenv.config();


ffmpeg.setFfmpegPath('/opt/homebrew/bin/ffmpeg');



const ELEVENLAB_KEY = "sk_a8c5fd86a68a757e9ee5e822c17654cae7df8336a9dbc61b";
const AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = "us-east-1";
const S3_BUCKET_NAME = "didvideoupload";
const RAPIDAPI_KEY = "90287b23damsh24ab22996157a66p178b0fjsn1f40752eeff5"

AWS.config.update({
  accessKeyId: AWS_ACCESS_KEY,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
  region: AWS_REGION
});


const s3 = new AWS.S3();

const app = express();

app.use(express.json({limit: '100mb'}));
app.use(cors());


// sub-step-1
const getActiveUrl = async (id: string) => {
  while (true) {
    const response = await fetch(`https://youtube-to-mp315.p.rapidapi.com/status/${id}`,
      {
        method: "GET",
        headers: {
          "x-rapidapi-host": "youtube-to-mp315.p.rapidapi.com",
          "x-rapidapi-key": RAPIDAPI_KEY
        }
      }
    )
    const data = await response.json();
    const status = data.status;
    if (status === "AVAILABLE") {
      console.log("conversion done...")
      return data.downloadUrl
    } else if (status === "CONVERSION_ERROR") {
      console.log(`conversion failed....`)
      return ''
    } else if (status === "CONVERTING") {
      console.log("Still converting checking in 5 seconds....")
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else {
      console.log(`Status is: ${status}. Exiting...`);
      return ""
    }
  }
}

// step-1
const extractAndSaveAudio = async (url: any, podcast: any) => {
  try {
    const options = {
      method: 'POST',
      url: 'https://youtube-to-mp315.p.rapidapi.com/download',
      params: {
        url: url,
        format: 'mp3'
      },
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': 'youtube-to-mp315.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    };
    const response = await axios.request(options);
    const output = path.resolve(`${podcast._id}output.mp3`);
    if (response.status === 200) {
      const responseId = await response.data.id;
      const url = await getActiveUrl(responseId)
      console.log(url, "mp3Url......")
      if(url?.length < 1){
        return {
          type: "default",
          voiceId: "pNInz6obpgDQGcFmaJgB"
        }
      }
      let data;
      let buffer: any;
      try {
        const res2 = await fetch(url, {
          method: "GET"
        });
        console.log(res2.status, "res2.status");
        data = await res2.arrayBuffer();
        buffer = await Buffer.from(new Uint8Array(data));
        await new Promise<void>((resolve, reject) => {
          fs.writeFile(output, buffer, (err) => {
            if (err) {
              console.log("Failed to save file", err);
              reject(err);
            } else {
              console.log("File saved successfully...");
              resolve();
            }
          });
        });
        console.log(data, "responseData...")
      } catch (err: any) {
        console.log(`error from download: ${err.message}`)
      }
      const formData = new FormData();
      const filePath = await path.resolve(`./${podcast._id}output.mp3`);
      await formData.append('files', fs.createReadStream(filePath));
      formData.append("name", Math.floor(Math.random() * 99999999));

      try {
        console.log("Sending request to ElevenLabs API...");
        const response = await axios.post('https://api.elevenlabs.io/v1/voices/add', formData, {
          headers: {
            ...formData.getHeaders(),
            "xi-api-key": ELEVENLAB_KEY
          },
        });
        console.log("Response from ElevenLabs:", response.data);
        const voiceId = response.data.voice_id;
        console.log("Voice ID:", voiceId);
        fs.unlink(output, (unlinkErr) => {
          if (unlinkErr) {
            console.error('Error deleting file:', unlinkErr)
          } else {
            console.log("Unlinked.....")
          }
        });
        return {
          type: "cloned",
          voiceId: voiceId
        };
      } catch (error: any) {
        console.error("Error in ElevenLabs API call:", error.response ? error.response.data : error.message);
        return {
          type: 'default',
          voiceId: "pNInz6obpgDQGcFmaJgB"
        }
      }
    } else {
       console.log("Audio clone not failed...");
       return {
        type: 'default',
        voiceId: 'pNInz6obpgDQGcFmaJgB'
       }
    }
  } catch (error: any) {
    console.error('Error in extractAndSaveAudio:', error.message);
    return {
      type: 'default',
      voiceId: 'pNInz6obpgDQGcFmaJgB'
    }
  }
};


// step-2
const getVoiceUrl = async (text: string, voiceId: string) => {
  try {
    console.log("Generating TTS....");
    const response = await axios({
      method: 'POST',
      url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      headers: {
        'xi-api-key': ELEVENLAB_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      data: { text: text },
      responseType: 'arraybuffer'
    });

    if (response.status === 200) {
      // Save the audio file
      const audioContent = await response.data;
      console.log('Preparing S3 upload params for audio...');
      const params = {
        Bucket: S3_BUCKET_NAME as string,
        Key: `audios/${uuidv4()}.mp3`,
        Body: audioContent,
        ContentType: 'audio/mpeg',
        ACL: 'public-read'
      };
      const result = await s3.upload(params).promise();
      console.log("Uploaded to s3.....");
      return result.Location
    } else {
      console.error('Audio fetch failed:', response.status, response.statusText);
      throw response.statusText
    }
  } catch (error: any) {
    console.error('Error in getVoice:', error.message);
  }
};

const transcodeAudio = async (url: string, audioFormat: string = 'mp3'): Promise<string> => {
  const outputFilePath = path.join(os.tmpdir(), `${uuidv4()}.${audioFormat}`); // Use the specified audio format
  return new Promise((resolve, reject) => {
    ffmpeg(url)
      .outputOptions('-acodec libmp3lame') // Use MP3 codec
      .outputOptions('-b:a 192k') // Set audio bitrate
      .outputOptions('-vn') // Disable video recording
      .on('end', () => {
        console.log(`Transcoded audio saved to ${outputFilePath}`);
        resolve(outputFilePath);
      })
      .on('error', (err) => {
        console.error('Error transcoding audio:', err);
        reject(err);
      })
      .save(outputFilePath);
  });
};


const mergeAudios = async (urls: string[]): Promise<string> => {
  const tempFile = path.join(os.tmpdir(), `${uuidv4()}.mp3`); // Changed to .mp3
  const command = ffmpeg();

  // Transcode each audio to a common format
  const transcodedFiles: string[] = [];
  for (const url of urls) {
    const transcodedFile = await transcodeAudio(url); // Updated to transcodeAudio
    transcodedFiles.push(transcodedFile);
    command.input(transcodedFile);
  }

  return new Promise((resolve, reject) => {
    command
      .on('start', (commandLine) => {
        console.log('Spawned ffmpeg with command: ' + commandLine);
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(err);
      })
      .on('end', () => {
        console.log('FFmpeg process completed');
        // Unlink transcoded files after merging
        transcodedFiles.forEach((file) => {
          fs.unlink(file, (err) => {
            if (err) {
              console.error(`Error deleting file ${file}:`, err);
            } else {
              console.log(`Deleted transcoded file: ${file}`);
            }
          });
        });
        resolve(tempFile);
      })
      .mergeToFile(tempFile, os.tmpdir());
  });
};


const uploadToS3 = async (filePath: any): Promise<string> => {
  console.log('uploading to s3......')
  const fileContent = fs.readFileSync(filePath);
  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: `audios/${path.basename(filePath)}`,
    Body: fileContent,
    ContentType: 'audio/mpeg',
    ACL: 'public-read'
  };


  const result = await s3.upload(params).promise();

   // Unlink the merged file after uploading
   fs.unlink(filePath, (err) => {
    if (err) {
      console.error(`Error deleting merged file ${filePath}:`, err);
    } else {
      console.log(`Deleted merged file: ${filePath}`);
    }
  });
  
  return result.Location;
};

// step-4
const updatepodcast = async (podcastId: string, newpodcast: any) => {
  console.log("Updating podcast.....")
  const response = await fetch('https://vendor.com/api/podcasts', {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ podcastId: podcastId, newPodcast: newpodcast })
  });

  if (response.ok) {
    console.log("podcast updated successfully....")
  }
  const data = await response.json();
  return data
};

app.post('/createPodcast', async (req, res) => {
  try {
    const currentPodcast = await req.body;
    console.log("Starting the process....");
    const hosts = [...currentPodcast.hosts];


    // step 1 - clone voice with hosts info
    console.log("Cloning voiec...")
    let detailedHost: any = [];
    for (const host of hosts) {
      console.log(`Assigning voice to ${host.name}`);
      const voiceData = await extractAndSaveAudio(host.voiceUrl, currentPodcast);
      const newVoiceId = voiceData.voiceId;
      const hostWithVoiceId = { ...host, voiceId: newVoiceId, voiceType: voiceData.type};
      detailedHost = [...detailedHost, hostWithVoiceId]
    };
    console.log("Voice clone done....detailed host: ", detailedHost)


    // Step 2: generate voice and save 
    let newContent : any = [];
    for(const script of currentPodcast.content){
      console.log(`Generating voice for: ${script.hostName}`);

      const voiceId = detailedHost.find((item : any)=> item.name === script.hostName).voiceId;

      const filteredScript = script.subtitle.replace(/[^\w\s.,'?!]/g, '');
      const voiceUrl = await getVoiceUrl(filteredScript, voiceId);
      
      const newResult = {...script, voiceUrl: voiceUrl};
      newContent = [...newContent, newResult];
      console.log(`Done generating voice url for: ${voiceId}`)
    };

    console.log("deleting all voice...")
    // Step 3: Delete voice
    for(const host of detailedHost){
      const type = host.voiceType;
      console.log(type, "type....")
      const voiceId = host.voiceId;
      if(type === "cloned"){
        console.log("Deleting voice....", voiceId, host.name)
        const deleteVoice = await axios.delete(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
          headers: {
            'xi-api-key': ELEVENLAB_KEY
          }
        });
        console.log(`Voice Deleted for: ${host.name} ${deleteVoice.status}`)
      }
    };
    console.log("All voice deleted...")

    console.log('marging audio url...')
    const audioUrls = newContent.map((item : any)=> item.voiceUrl);
    const filePath = await mergeAudios(audioUrls);
    const s3Url = await uploadToS3(filePath)
    console.log('marge complete......')




    // Step 4: Update the podcast
    const newpodcast = {
      ...currentPodcast,
      content: [...newContent],
      audioUrl: s3Url,
      active: true
    };
    console.log("updating podcast...")
    const updatedpodcast = await updatepodcast(currentPodcast._id, newpodcast)

    console.log("It was a successfull run... Exiting...")
    res.status(200).json({updatedpodcast});

  } catch (error: any) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'Failed to process request', details: error.message });
  }
});

const PORT = 5003;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Podcast creation running on ${PORT}`);
});

export default app;