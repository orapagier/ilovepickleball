-- AlterEnum
-- Adds more than one value to an enum, which needs PostgreSQL 12 or later.
ALTER TYPE "TournamentFormat" ADD VALUE 'double_elimination';
ALTER TYPE "TournamentFormat" ADD VALUE 'pool_to_bracket';
ALTER TYPE "TournamentFormat" ADD VALUE 'swiss';

-- CreateEnum
CREATE TYPE "MatchBracket" AS ENUM ('winners', 'losers', 'grand_final', 'grand_final_reset');

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "poolCount" INTEGER,
ADD COLUMN     "advancePerPool" INTEGER,
ADD COLUMN     "swissRounds" INTEGER;

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "pool" INTEGER;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "loserNextMatchId" TEXT,
ADD COLUMN     "loserNextMatchSlot" "MatchSlot",
ADD COLUMN     "bracket" "MatchBracket",
ADD COLUMN     "pool" INTEGER;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_loserNextMatchId_fkey" FOREIGN KEY ("loserNextMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
