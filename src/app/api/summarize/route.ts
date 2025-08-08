import { summarizationModel } from "@/lib/gemini";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { zfd } from "zod-form-data";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import axios from "axios";
import * as cheerio from "cheerio";

const schema = zfd.formData({
  file: z.instanceof(File).optional(),
  url: z.string().optional(),
});

async function extractText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  if (file.type === "application/pdf") {
    const data = await pdf(buffer);
    return data.text;
  }
  if (file.type.includes("wordprocessingml")) { // .docx
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  throw new Error("Unsupported file type.");
}

async function fetchUrlText(url: string) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  // Remove script and style tags to clean up the text
  $('script, style').remove();
  return $("body").text().replace(/\s\s+/g, ' ').trim();
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const validation = schema.safeParse(formData);

    if (!validation.success) {
      return NextResponse.json({ message: validation.error.errors[0].message }, { status: 400 });
    }

    const { file, url } = validation.data;
    let content = "";

    if (file) {
      content = await extractText(file);
    } else if (url) {
      content = await fetchUrlText(url);
    } else {
      return NextResponse.json({ message: "File or URL required." }, { status: 400 });
    }

    const prompt = `Please provide a concise summary of the following text. Extract the key points and main arguments. The summary should be easy to read and capture the essence of the content. TEXT: """${content.substring(0, 30000)}"""`;

    const result = await summarizationModel.generateContent(prompt);
    const summary = await result.response.text();

    return NextResponse.json({ summary });
  } catch (error: any) {
    console.error("Error summarizing content:", error);
    return NextResponse.json({ message: error.message || "Internal server error" }, { status: 500 });
  }
}