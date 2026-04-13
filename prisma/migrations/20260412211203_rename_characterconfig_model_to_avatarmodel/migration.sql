/*
  Warnings:

  - You are about to drop the column `model` on the `CharacterConfig` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CharacterConfig" DROP COLUMN "model",
ADD COLUMN     "avatarModel" TEXT NOT NULL DEFAULT '/Aimee.glb';
