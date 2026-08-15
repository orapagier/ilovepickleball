-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "averageMatchMinutes" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN     "courtChangeoverMinutes" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "averageMatchMinutes" INTEGER,
ADD COLUMN     "courtChangeoverMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "sessionId" TEXT;

-- CreateTable
CREATE TABLE "TournamentSession" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TournamentSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentSession_tournamentId_startAt_idx" ON "TournamentSession"("tournamentId", "startAt");

-- CreateIndex
CREATE INDEX "Match_sessionId_idx" ON "Match"("sessionId");

-- AddForeignKey
ALTER TABLE "TournamentSession" ADD CONSTRAINT "TournamentSession_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TournamentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

