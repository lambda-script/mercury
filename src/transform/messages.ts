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

export async function transformRequest(
  body: MessagesRequestBody,
  detector: Detector,
  translator: Translator,
  targetLang: string,
): Promise<MessagesRequestBody> {
  logger.info(`Transforming request with ${body.messages.length} messages`);

  const translatedMessages = await Promise.all(
    body.messages.map((msg) => translateMessage(msg, detector, translator, targetLang)),
  );

  // system prompt is left untouched (assumed English)
  return {
    ...body,
    messages: translatedMessages,
  };
}
