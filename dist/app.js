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
dotenv_1.default.config();
const ELEVENLAB_KEY = "sk_a8c5fd86a68a757e9ee5e822c17654cae7df8336a9dbc61b";
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
app.use(express_1.default.json({ limit: '100mb' }));
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
            if ((url === null || url === void 0 ? void 0 : url.length) < 1) {
                return {
                    type: "default",
                    voiceId: "pNInz6obpgDQGcFmaJgB"
                };
            }
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
            formData.append("name", Math.floor(Math.random() * 99999999));
            try {
                console.log("Sending request to ElevenLabs API...");
                const response = yield axios_1.default.post('https://api.elevenlabs.io/v1/voices/add', formData, {
                    headers: Object.assign(Object.assign({}, formData.getHeaders()), { "xi-api-key": ELEVENLAB_KEY }),
                });
                console.log("Response from ElevenLabs:", response.data);
                const voiceId = response.data.voice_id;
                console.log("Voice ID:", voiceId);
                fs_1.default.unlink(output, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error('Error deleting file:', unlinkErr);
                    }
                    else {
                        console.log("Unlinked.....");
                    }
                });
                return {
                    type: "cloned",
                    voiceId: voiceId
                };
            }
            catch (error) {
                console.error("Error in ElevenLabs API call:", error.response ? error.response.data : error.message);
                return {
                    type: 'default',
                    voiceId: "pNInz6obpgDQGcFmaJgB"
                };
            }
        }
        else {
            console.log("Audio clone not failed...");
            return {
                type: 'default',
                voiceId: 'pNInz6obpgDQGcFmaJgB'
            };
        }
    }
    catch (error) {
        console.error('Error in extractAndSaveAudio:', error.message);
        return {
            type: 'default',
            voiceId: 'pNInz6obpgDQGcFmaJgB'
        };
    }
});
// step-2
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
            console.log("Uploaded to s3.....");
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
// step-4
const updatepodcast = (podcastId, newpodcast) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("Updating podcast.....");
    const response = yield fetch('https://vendor.com/api/podcasts', {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ podcastId: podcastId, newPodcast: newpodcast })
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
        console.log("Starting the process....");
        const hosts = [...currentPodcast.hosts];
        // step 1 - clone voice with hosts info
        console.log("Cloning voiec...");
        let detailedHost = [];
        for (const host of hosts) {
            console.log(`Assigning voice to ${host.name}`);
            const voiceData = yield extractAndSaveAudio(host.voiceUrl, currentPodcast);
            const newVoiceId = voiceData.voiceId;
            const hostWithVoiceId = Object.assign(Object.assign({}, host), { voiceId: newVoiceId, voiceType: voiceData.type });
            detailedHost = [...detailedHost, hostWithVoiceId];
        }
        ;
        console.log("Voice clone done....detailed host: ", detailedHost);
        // Step 2: generate voice and save 
        let newContent = [];
        for (const script of currentPodcast.content) {
            console.log(`Generating voice for: ${script.hostName}`);
            const voiceId = detailedHost.find((item) => item.name === script.hostName).voiceId;
            const filteredScript = script.subtitle.replace(/[^\w\s.,'?!]/g, '');
            const voiceUrl = yield getVoiceUrl(filteredScript, voiceId);
            const newResult = Object.assign(Object.assign({}, script), { voiceUrl: voiceUrl });
            newContent = [...newContent, newResult];
            console.log(`Done generating voice url for: ${voiceId}`);
        }
        ;
        console.log("deleting all voice...");
        // Step 3: Delete voice
        for (const host of detailedHost) {
            const type = host.voiceType;
            console.log(type, "type....");
            const voiceId = host.voiceId;
            if (type === "cloned") {
                console.log("Deleting voice....", voiceId, host.name);
                const deleteVoice = yield axios_1.default.delete(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
                    headers: {
                        'xi-api-key': ELEVENLAB_KEY
                    }
                });
                console.log(`Voice Deleted for: ${host.name} ${deleteVoice.status}`);
            }
        }
        ;
        console.log("All voice deleted...");
        // Step 4: Update the podcast
        const newpodcast = Object.assign(Object.assign({}, currentPodcast), { content: [...newContent], active: true });
        console.log("updating podcast...");
        const updatedpodcast = yield updatepodcast(currentPodcast._id, newpodcast);
        console.log("It was a successfull run... Exiting...");
        res.status(200).json({ updatedpodcast, newContent });
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
