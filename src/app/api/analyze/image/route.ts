import { visionModel } from "@/lib/gemini";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  image: z.string().min(1, "Image data is required."),
  mimeType: z.string().min(1, "MIME type is required."),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validation = schema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ message: validation.error.errors[0].message }, { status: 400 });
    }

    const { image, mimeType } = validation.data;
    const prompt = "Describe this image in detail. Be descriptive and vivid. Mention the key objects, the setting, any people and their apparent emotions, and the overall mood of the image.";

    const imagePart = {
      inlineData: {
        data: image,
        mimeType: mimeType,
      },
    };

    const result = await visionModel.generateContent([prompt, imagePart]);
    const response = await result.response;
    const description = response.text();

    return NextResponse.json({ description });
  } catch (error) {
    console.error("Error analyzing image:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}