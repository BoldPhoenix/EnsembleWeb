-- CreateEnum
CREATE TYPE "LlmProvider" AS ENUM ('openrouter', 'gemini', 'ollama');

-- AlterTable
ALTER TABLE "CharacterConfig" ADD COLUMN     "llmModel" TEXT,
ADD COLUMN     "provider" "LlmProvider" NOT NULL DEFAULT 'openrouter';
