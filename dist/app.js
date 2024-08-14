"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const form_data_1 = __importDefault(require("form-data"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const axios_1 = __importDefault(require("axios"));
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const uuid_1 = require("uuid");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
dotenv_1.default.config();
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ELEVENLAB_KEY = "8339ed653a92fb25e0d1f1270121b055";
const AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = "us-east-1";
const S3_BUCKET_NAME = "didvideoupload";
const RAPIDAPI_KEY = "90287b23damsh24ab22996157a66p178b0fjsn1f40752eeff5";
aws_sdk_1.default.config.update({
    accessKeyId: AWS_ACCESS_KEY,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    region: AWS_REGION
});
const s3 = new aws_sdk_1.default.S3();
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)());
// sub-step-1
const getActiveUrl = (id) => __awaiter(void 0, void 0, void 0, function* () {
    while (true) {
        const response = yield fetch(`https://youtube-to-mp315.p.rapidapi.com/status/${id}`, {
            method: "GET",
            headers: {
                "x-rapidapi-host": "youtube-to-mp315.p.rapidapi.com",
                "x-rapidapi-key": RAPIDAPI_KEY
            }
        });
        const data = yield response.json();
        const status = data.status;
        if (status === "AVAILABLE") {
            console.log("conversion done...");
            return data.downloadUrl;
        }
        else if (status === "CONVERSION_ERROR") {
            console.log(`conversion failed....`);
            return '';
        }
        else if (status === "CONVERTING") {
            console.log("Still converting checking in 5 seconds....");
            yield new Promise(resolve => setTimeout(resolve, 5000));
        }
        else {
            console.log(`Status is: ${status}. Exiting...`);
            return "";
        }
    }
});
// step-1
const extractAndSaveAudio = (url, podcast) => __awaiter(void 0, void 0, void 0, function* () {
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
        const response = yield axios_1.default.request(options);
        const output = path_1.default.resolve(`${podcast._id}output.mp3`);
        if (response.status === 200) {
            const responseId = yield response.data.id;
            const url = yield getActiveUrl(responseId);
            console.log(url, "mp3Url......");
            let data;
            let buffer;
            try {
                const res2 = yield fetch(url, {
                    method: "GET"
                });
                console.log(res2.status, "res2.status");
                data = yield res2.arrayBuffer();
                buffer = yield Buffer.from(new Uint8Array(data));
                yield new Promise((resolve, reject) => {
                    fs_1.default.writeFile(output, buffer, (err) => {
                        if (err) {
                            console.log("Failed to save file", err);
                            reject(err);
                        }
                        else {
                            console.log("File saved successfully...");
                            resolve();
                        }
                    });
                });
                console.log(data, "responseData...");
            }
            catch (err) {
                console.log(`error from download: ${err.message}`);
            }
            const formData = new form_data_1.default();
            const filePath = yield path_1.default.resolve(`./${podcast._id}output.mp3`);
            yield formData.append('files', fs_1.default.createReadStream(filePath));
            formData.append("name", podcast.name);
            try {
                console.log("Sending request to ElevenLabs API...");
                const response = yield axios_1.default.post('https://api.elevenlabs.io/v1/voices/add', formData, {
                    headers: Object.assign(Object.assign({}, formData.getHeaders()), { "xi-api-key": ELEVENLAB_KEY }),
                });
                console.log("Response from ElevenLabs:", response.data);
                const voiceId = response.data.voice_id;
                console.log("Voice ID:", voiceId);
                fs_1.default.unlink(output, (unlinkErr) => {
                    if (unlinkErr)
                        console.error('Error deleting file:', unlinkErr);
                });
                return voiceId;
            }
            catch (error) {
                console.error("Error in ElevenLabs API call:", error.response ? error.response.data : error.message);
                throw error;
            }
        }
        else {
            throw new Error("Audio file not created");
        }
    }
    catch (error) {
        console.error('Error in extractAndSaveAudio:', error.message);
        throw error.message;
    }
});
// step-2
const getTranscript = (url) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const currentVideoId = (_b = (_a = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/)) === null || _a === void 0 ? void 0 : _a[1]) !== null && _b !== void 0 ? _b : null;
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
    const response = yield axios_1.default.request(options);
    const data = yield response.data[0];
    const fullTexts = data.transcriptionAsText;
    return fullTexts;
});
// sub-step-3
const formateScript = (script) => __awaiter(void 0, void 0, void 0, function* () {
    // Split the transcript into segments
    const segments = script.split('@@@').filter((segment) => segment.trim() !== '');
    // Map each segment to an object
    const result = segments.map((seg) => {
        const [speaker, ...contentParts] = seg.split(':');
        const content = contentParts.join(':').trim();
        // Create an object with the speaker as the key and content as the value
        return content;
    });
    return result.filter(res => res !== undefined && res.length > 0);
});
// step-3
const anthropic = new sdk_1.default({
    apiKey: ANTHROPIC_API_KEY || '',
});
const generateScript = (text, hosts) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const hostNames = hosts.map((host) => host.name);
        const buildPrompt = `Your are expert in generating podcast script. Now you have to generate a podcast string based on this transcript below: \n\n${text}. \nUse the content idea from the given transcript to generate the script. \n\nPlease make a perfect podcast script whith these hosts ${hostNames.join(", ")}. Please put "@@@HostName:" in start of each speech. Make it around 20 - 25 minutes podcast script. Please don't put any unnecessary word, sentence, [music] or emphasis except the script of the podcast. Please make each speech as long as possible.`;
        const messages = [{ role: "user", content: buildPrompt }];
        const response = yield anthropic.messages.create({
            messages: messages,
            model: "claude-3-sonnet-20240229",
            max_tokens: 4096,
            stream: false,
        });
        const content = response.content[0];
        const generatedScript = content.text;
        return generatedScript;
    }
    catch (err) {
        console.error(err.message, "from generageScript function..");
        throw err.message;
    }
});
// step-4
const getVoiceUrl = (text, voiceId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("Generating TTS....");
        const response = yield (0, axios_1.default)({
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
            const audioContent = yield response.data;
            console.log('Preparing S3 upload params for audio...');
            const params = {
                Bucket: S3_BUCKET_NAME,
                Key: `audios/${(0, uuid_1.v4)()}.mp3`,
                Body: audioContent,
                ContentType: 'audio/mpeg',
                ACL: 'public-read'
            };
            const result = yield s3.upload(params).promise();
            return result.Location;
        }
        else {
            console.error('Audio fetch failed:', response.status, response.statusText);
            throw response.statusText;
        }
    }
    catch (error) {
        console.error('Error in getVoice:', error.message);
    }
});
// step-5
const updatepodcast = (podcastId, newpodcast) => __awaiter(void 0, void 0, void 0, function* () {
    const response = yield fetch('https://beta.vendor.com/api/podcasts', {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ podcastId: podcastId, newpodcast: newpodcast })
    });
    if (response.ok) {
        console.log("podcast updated successfully....");
    }
    const data = yield response.json();
    return data;
});
app.post('/createPodcast', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const currentPodcast = yield req.body;
        console.log(currentPodcast, "Starting the process....");
        const hosts = [...currentPodcast.hosts];
        // step 1 - clone voice with hosts info
        let detailedHost = [];
        for (const host of hosts) {
            console.log(`Assigning voice to ${host.name}`);
            // const newVoiceId = await extractAndSaveAudio(host.voiceUrl, currentPodcast);
            const newVoiceId = ["nPczCjzI2devNBz1zQrb", "LcfcDJNUP1GQjkzn1xUU", "jsCqWAovK2LkecY7zXl4", "FGY2WhTYpPnrIDTdsKH5"][Math.floor(Math.random() * 4)];
            const hostWithVoiceId = Object.assign(Object.assign({}, host), { voiceId: newVoiceId });
            detailedHost = [...detailedHost, hostWithVoiceId];
        }
        ;
        // step 2 - get the transcript
        const videoUrl = currentPodcast.videoUrl;
        const transcript = yield getTranscript(videoUrl);
        // console.log(transcript, "transcript..........")
        // step 3 - generate script
        let scripts = [];
        const generatedSrcipt = yield generateScript(transcript, hosts);
        const formatedScript = yield formateScript(generatedSrcipt);
        for (const script of formatedScript) {
            console.log(`Filtering script....`);
            const index = formatedScript.indexOf(script);
            const isEven = index % 2 === 0;
            let result;
            if (isEven) {
                result = { text: script, voiceId: detailedHost[0].voiceId, name: detailedHost[0].name };
            }
            else {
                result = { text: script, voiceId: detailedHost[1].voiceId, name: detailedHost[1].name };
            }
            scripts = [...scripts, result];
        }
        ;
        // step 4 - generate voice and save 
        let voiceResults = [];
        for (const script of scripts) {
            console.log(`Generating voice for: ${script.name}`);
            const voiceUrl = yield getVoiceUrl(script.text, script.voiceId);
            // const encodedVoiceId = encodeURIComponent(script.voiceId)
            // const deleteVoice = await axios.delete(`https://api.elevenlabs.io/v1/voices/${encodedVoiceId}`, {
            //   headers: {
            //     'xi-api-key': ELEVENLAB_KEY
            //   }
            // });
            const newResult = { hostName: script.name, subtitle: script.text, voiceUrl: voiceUrl };
            voiceResults = [...voiceResults, newResult];
            console.log(`Done generating voice url....`);
        }
        ;
        // Step 5: Update the podcast
        // const newpodcast = {
        //   ...currentPodcast,
        //   active: true
        // };
        // console.log(newpodcast, "new podcast.....")
        // const updatedpodcast = await updatepodcast(currentPodcast._id, newpodcast)
        console.log("It was a successfull run... Exiting...");
        res.status(200).json({ voiceResults });
    }
    catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ error: 'Failed to process request', details: error.message });
    }
}));
const PORT = 5003;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Podcast creation running on ${PORT}`);
});
exports.default = app;
