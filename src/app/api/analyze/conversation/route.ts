import { textModel } from "@/lib/gemini";
import { DeepgramClient, createClient } from "@deepgram/sdk";
import { HfInference } from "@huggingface/inference";
import { NextRequest, NextResponse } from "next/server";
import { zfd } from "zod-form-data";
import { z } from "zod";

const schema = zfd.formData({ file: z.instanceof(File) });

// This custom function is the core of the diarization logic
const combineSttAndDiarization = (sttResult: any, diarizationResult: any[]) => {
    const combined = [];
    let currentSegment = { speaker: '', text: '' };

    const sttWords = sttResult.results.channels[0].alternatives[0].words;

    for (const word of sttWords) {
        const wordMidpoint = word.start + (word.end - word.start) / 2;
        let speaker = "UNKNOWN";

        for (const segment of diarizationResult) {
            if (wordMidpoint >= segment.start && wordMidpoint <= segment.end) {
                speaker = segment.speaker;
                break;
            }
        }
        
        if (currentSegment.speaker !== speaker && currentSegment.speaker) {
            combined.push({ ...currentSegment });
            currentSegment = { speaker, text: '' };
        }
        
        currentSegment.speaker = speaker;
        currentSegment.text += word.punctuated_word + ' ';
    }
    if (currentSegment.text) {
        combined.push(currentSegment);
    }

    return combined.map(seg => ({ ...seg, text: seg.text.trim() }));
};

export async function POST(req: NextRequest) {
  try {
    const deepgram: DeepgramClient = createClient(process.env.DEEPGRAM_API_KEY!);
    const hf = new HfInference(process.env.HF_TOKEN!);

    const formData = await req.formData();
    const { file } = schema.parse(formData);
    const audioBuffer = Buffer.from(await file.arrayBuffer());

    const [sttPromise, diarizationPromise] = await Promise.allSettled([
        deepgram.listen.prerecorded.transcribeFile(audioBuffer, {
            model: "nova-2",
            smart_format: true,
            punctuate: true,
            word_timestamps: true,
        }),
        hf.audio.speechToText({
            data: audioBuffer,
            model: "pyannote/speaker-diarization-3.1",
        }),
    ]);
    
    if (sttPromise.status === 'rejected' || diarizationPromise.status === 'rejected') {
        console.error("STT Error:", sttPromise.status === 'rejected' && sttPromise.reason);
        console.error("Diarization Error:", diarizationPromise.status === 'rejected' && diarizationPromise.reason);
        throw new Error("Failed to process audio with external services.");
    }
    
    const sttResult = sttPromise.value;
    const hfResult = diarizationPromise.value as any; // Cast to any to access chunks
    const diarizationSegments = hfResult.chunks;

    const fullTranscript = sttResult.results.channels[0].alternatives[0].transcript;
    const diarizedTranscript = combineSttAndDiarization(sttResult, diarizationSegments);
    
    const summaryPrompt = `Summarize this conversation. Identify the main topics, any decisions made, and action items for each speaker. TRANSCRIPT: ${fullTranscript}`;
    const summaryResult = await textModel.generateContent(summaryPrompt);
    const summary = await summaryResult.response.text();
    
    return NextResponse.json({
        summary,
        transcript: fullTranscript,
        diarizedTranscript,
    });

  } catch (error: any) {
    console.error("Conversation analysis error:", error);
    return NextResponse.json({ message: error.message || "Internal Server Error" }, { status: 500 });
  }
}