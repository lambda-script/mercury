import type { Detector } from "../detector/index.js";
import type { Translator } from "../translator/index.js";
import { logger } from "../utils/logger.js";

// Anthropic Messages API types (simplified)
interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

interface ImageBlock {
  readonly type: "image";
  readonly source: unknown;
}

interface ToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

interface ToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content?: string | readonly ContentBlock[];
}

type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

interface Message {
  readonly role: string;
  readonly content: string | readonly ContentBlock[];
}

export interface MessagesRequestBody {
  readonly messages: readonly Message[];
  readonly system?: string | readonly ContentBlock[];
  readonly [key: string]: unknown;
}

async function translateText(
  text: string,
  detector: Detector,
  translator: Translator,
  targetLang: string,
): Promise<string> {
  if (detector.isTargetLang(text, targetLang)) {
    logger.debug("Text already in target language, skipping translation");
    return text;
  }
  return translator.translate(text, "auto", targetLang);
}

async function translateContentBlock(
  block: ContentBlock,
  detector: Detector,
  translator: Translator,
  targetLang: string,
): Promise<ContentBlock> {
  switch (block.type) {
    case "text": {
      const translated = await translateText(block.text, detector, translator, targetLang);
      return { ...block, text: translated };
    }
    case "tool_use":
      // Never translate tool_use.input - would corrupt JSON parameters
      return block;
    case "tool_result": {
      if (!block.content) return block;
      if (typeof block.content === "string") {
        const translated = await translateText(block.content, detector, translator, targetLang);
        return { ...block, content: translated };
      }
      // Array of content blocks
      const translatedBlocks = await translateContentBlocks(block.content, detector, translator, targetLang);
      return { ...block, content: translatedBlocks };
    }
    case "image":
      return block;
    default:
      return block;
  }
}

async function translateContentBlocks(
  blocks: readonly ContentBlock[],
  detector: Detector,
  translator: Translator,
  targetLang: string,
): Promise<ContentBlock[]> {
  return Promise.all(
    blocks.map((block) => translateContentBlock(block, detector, translator, targetLang)),
  );
}

async function translateMessage(
  message: Message,
  detector: Detector,
  translator: Translator,
  targetLang: string,
): Promise<Message> {
  if (typeof message.content === "string") {
    const translated = await translateText(message.content, detector, translator, targetLang);
    return { ...message, content: translated };
  }

  const translatedContent = await translateContentBlocks(
    message.content,
    detector,
    translator,
    targetLang,
  );
  return { ...message, content: translatedContent };
}

// ISO 639-3 codes used by franc → human-readable language names
const LANG_NAMES: Record<string, string> = {
  jpn: "Japanese",
  kor: "Korean",
  cmn: "Chinese",
  zho: "Chinese",
  vie: "Vietnamese",
  tha: "Thai",
  ara: "Arabic",
  hin: "Hindi",
  ben: "Bengali",
  rus: "Russian",
  ukr: "Ukrainian",
  deu: "German",
  fra: "French",
  spa: "Spanish",
  por: "Portuguese",
  ita: "Italian",
  nld: "Dutch",
  pol: "Polish",
  tur: "Turkish",
  ind: "Indonesian",
  msa: "Malay",
};

function detectSourceLang(body: MessagesRequestBody, detector: Detector): string | null {
  for (const msg of body.messages) {
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") {
      const result = detector.detect(msg.content);
      if (result.confidence > 0) return result.lang;
    } else {
      for (const block of msg.content) {
        if (block.type === "text") {
          const result = detector.detect(block.text);
          if (result.confidence > 0) return result.lang;
        }
      }
    }
  }
  return null;
}

function injectResponseLang(
  system: string | readonly ContentBlock[] | undefined,
  langCode: string,
): string | readonly ContentBlock[] {
  const langName = LANG_NAMES[langCode] ?? langCode;
  const instruction = `IMPORTANT: Always respond in ${langName}.`;

  if (!system) {
    return instruction;
  }
  if (typeof system === "string") {
    return `${system}\n\n${instruction}`;
  }
  return [...system, { type: "text" as const, text: instruction }];
}

export async function transformRequest(
  body: MessagesRequestBody,
  detector: Detector,
  translator: Translator,
  targetLang: string,
): Promise<MessagesRequestBody> {
  logger.info(`Transforming request with ${body.messages.length} messages`);

  // Detect original language before translation
  const sourceLang = detectSourceLang(body, detector);
  const needsLangInjection = sourceLang !== null && sourceLang !== targetLang;

  const translatedMessages = await Promise.all(
    body.messages.map((msg) => translateMessage(msg, detector, translator, targetLang)),
  );

  return {
    ...body,
    messages: translatedMessages,
    ...(needsLangInjection ? { system: injectResponseLang(body.system, sourceLang) } : {}),
  };
}
