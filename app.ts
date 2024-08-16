import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import FormData from 'form-data';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
dotenv.config();



const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ELEVENLAB_KEY = "8339ed653a92fb25e0d1f1270121b055";
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

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY || '',
});

const s3 = new AWS.S3();

const app = express();

app.use(express.json());
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
      formData.append("name", podcast.name);

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
          if (unlinkErr) console.error('Error deleting file:', unlinkErr);
        });
        return voiceId;
      } catch (error: any) {
        console.error("Error in ElevenLabs API call:", error.response ? error.response.data : error.message);
        throw error;
      }
    } else {
      throw new Error("Audio file not created");
    }
  } catch (error: any) {
    console.error('Error in extractAndSaveAudio:', error.message);
    throw error.message;
  }
};

// step-2
const getTranscript = async (url: string) => {
  console.log("getting transcript....")
  const currentVideoId = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/)?.[1] ?? null;
  const options = {
    method: 'GET',
    url: 'https://youtube-transcriptor.p.rapidapi.com/transcript',
    params: {
      video_id: currentVideoId,
    },
    headers: {
      'x-rapidapi-host': 'youtube-transcriptor.p.rapidapi.com',
      'x-rapidapi-key': RAPIDAPI_KEY
    }
  };
  const response = await axios.request(options);
  const data = await response.data[0];
  const fullTexts = data.transcriptionAsText;
  return fullTexts
};


// generate topic 
const generateTopic = async (text: string)=>{
  try {

    const buildPrompt = `I am giving you a transcript. You need to analyze the transcript and generate the title of the transcript. The title must be within 5 words. Only respond with the generated topic. Must not put any single word without the topic in your response. Respond with only the topic. Do not respond with any greeting message or confirmation message except the topic. Must put "@@@" before the topic. \nHere is the transcript: ${text}.`

    const messages: any = [{ role: "user", content: buildPrompt }]

    const response = await anthropic.messages.create({
      messages: messages,
      model: "claude-3-sonnet-20240229",
      max_tokens: 4096,
      stream: false,
    });

    const content: any = response.content[0];
    const generatedTopic = content.text;
    let formatedTopic;
    const segments: string[] = generatedTopic.split('@@@');
    if (segments.length >= 2) {
      // Return the trimmed second part (index 1)
       formatedTopic = segments[1].trim();
    } else {
      formatedTopic = segments[0].trim();
    }

    return formatedTopic
  } catch (err: any) {
    console.error(err, "from generateScript function..")
    throw err.message
  }
}

// sub-step-3
const formateScript = async (script: string) => {
  // Split the transcript into segments
  const segments: string[] = script.split('@@@').filter((segment: string) => segment.trim() !== '');
  
  // Map each segment to an object
  const result = segments.map((seg: string) => {
    const [speaker, ...contentParts] = seg.split(':');
    const content = contentParts.join(':').trim();
    
    // Create an object with the speaker as the key and content as the value
    return content;
  });

  return result.filter(res=> res !== undefined && res.length > 0)
};

// step-3
const generateScript = async (text: string, hosts: any[], topic: string) => {
  console.log('Generating script.....')
  try {
    const hostNames = hosts.map((host) => host.name);

    const buildPrompt = `Your are expert in generating podcast script. Now you have to generate a copmpete podcast script based on this transcript below: \n\nThis is the transcript: \n${text}. \nThis is the topic of the podcast: ${topic}. \nPut the similar context of the transcript in the speeches of podcast script. \n \n\nMake a perfect podcast script whith these hosts ${hostNames.join(", ")}. Do not include any other hosts except those. Please put "@@@<The host of the speech>:" in start of each speech. Make the script as long as it should take 30/40 minutes to read. Don't put any unnecessary word, sentence, [music] or emphasis except the script of the podcast. Please make each speech as long as possible. Write the script as close as human talks. Write it in a way so that the result of the TTS of your generated podcast sounds realistic. Not robotic. I am giving you some example to make the speeches more humanly. \n\n
    \nVary Sentence Length: Mix short and long sentences to mimic natural speech patterns. Longer sentences should have appropriate pauses, while shorter ones can create impact or emphasize a point.
    \nUse Ellipses for Pauses: An ellipsis (…) can indicate a pause or a trailing off in thought, which can add a conversational tone.
    \nParentheses for Asides: Use parentheses to insert asides or extra information, which can make the voice sound more reflective or thoughtful.
    \nColons and Semicolons: These can help break up complex sentences, creating more natural pauses that prevent the voice from sounding too mechanical.
    \nQuotation Marks: Use these for direct speech or to emphasize certain words or phrases, which can make the voice sound more engaging.
    \nVary Punctuation: Combining different punctuation marks (e.g., ?!) can convey stronger emotions like surprise or excitement, adding more expressiveness to the voice.
    \nAdd Exclamations or Interjections: Words like “Oh,” “Wow,” or “Well,” can make the voice sound more dynamic and natural.
    \nEmphasize Key Words: You can italicize or bold key words in the text, which can instruct the AI to place more emphasis on them, simulating how humans naturally stress important words.
    \nBreaking Sentences: If a sentence has multiple ideas, consider breaking it into smaller, more digestible parts. This will make the speech pattern more fluid and easier to follow.
    \nUse Dashes for Interruptions: Dashes (—) can indicate a sudden break or change in thought, mimicking how people often interrupt themselves mid-sentence.
    \nAdjust for Tone: Depending on the context, you might want to soften or harden certain phrases by tweaking the punctuation or word choice to better match the intended emotional tone.
    `

    const messages: any = [{ role: "user", content: buildPrompt }]

    const response = await anthropic.messages.create({
      messages: messages,
      model: "claude-3-sonnet-20240229",
      max_tokens: 4096,
      stream: false,
    });

    const content: any = response.content[0];
    const generatedScript = content.text;

    return generatedScript
  } catch (err: any) {
    console.error(err, "from generateScript function..")
    throw err.message
  }
};


// step-4
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
      return result.Location
    } else {
      console.error('Audio fetch failed:', response.status, response.statusText);
      throw response.statusText
    }
  } catch (error: any) {
    console.error('Error in getVoice:', error.message);
  }
};

// step-5
const updatepodcast = async (podcastId: string, newpodcast: any) => {
  console.log("Updating podcast.....")
  const response = await fetch('https://beta.vendor.com/api/podcasts', {
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
    console.log(currentPodcast, "Starting the process....");
    const hosts = [...currentPodcast.hosts];


    // step 1 - clone voice with hosts info
    console.log("Cloning voiec...")
    let detailedHost: any = [];
    for (const host of hosts) {
      console.log(`Assigning voice to ${host.name}`);
      // const newVoiceId = await extractAndSaveAudio(host.voiceUrl, currentPodcast);
      const newVoiceId = ["onwK4e9ZLuTAKqWW03F9", "onwK4e9ZLuTAKqWW03F9", "onwK4e9ZLuTAKqWW03F9", "onwK4e9ZLuTAKqWW03F9"][Math.floor(Math.random() * 4)];
      const hostWithVoiceId = { ...host, voiceId: newVoiceId };
      detailedHost = [...detailedHost, hostWithVoiceId]
    };
    console.log("Voice clone done....")

    // step 2 - get the transcript
    const videoUrl = currentPodcast.videoUrl;
    const transcript = await getTranscript(videoUrl);
    console.log( "transcript generated...........")

    console.log("Generating topic")
    const topic  = await generateTopic(transcript);
    console.log(topic, "Topic generated.....")

    
    // step 3 - generate script
    let scripts: any = [];
    const generatedSrcipt = await generateScript(transcript, hosts, topic);
    console.log( "script generated......")
    const formatedScript = await formateScript(generatedSrcipt);
    console.log( "script formated......")

    for(const script of formatedScript){
      const index = formatedScript.indexOf(script);
      const isEven = index % 2 === 0;
      let result;
      if(isEven) {
        result = {text: script, voiceId: detailedHost[0].voiceId, name: detailedHost[0].name}
      } else {
        result = {text: script, voiceId: detailedHost[1].voiceId, name: detailedHost[1].name}
      }
      scripts = [...scripts, result]
    };


    // step 4 - generate voice and save 
    let voiceResults : any = [];
    for(const script of scripts){
      console.log(`Generating voice for: ${script.name}`)
      const voiceUrl = await getVoiceUrl(script.text, script.voiceId);
      // const encodedVoiceId = encodeURIComponent(script.voiceId)
      // const deleteVoice = await axios.delete(`https://api.elevenlabs.io/v1/voices/${encodedVoiceId}`, {
      //   headers: {
      //     'xi-api-key': ELEVENLAB_KEY
      //   }
      // });
      const newResult = {hostName: script.name, subtitle: script.text, voiceUrl: voiceUrl};
      voiceResults = [...voiceResults, newResult];
      console.log(`Done generating voice url....`)
    };


    // Step 5: Update the podcast
    const newpodcast = {
      ...currentPodcast,
      topic: topic,
      content: [...voiceResults],
      active: true
    };
    console.log(newpodcast, "new podcast.....")
    const updatedpodcast = await updatepodcast(currentPodcast._id, newpodcast)

    console.log("It was a successfull run... Exiting...")
    res.status(200).json({updatedpodcast, voiceResults});

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