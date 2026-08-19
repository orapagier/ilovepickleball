-- CreateTable
CREATE TABLE "TournamentPrize" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "place" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TournamentPrize_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentPrize_tournamentId_idx" ON "TournamentPrize"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentPrize_tournamentId_place_key" ON "TournamentPrize"("tournamentId", "place");

-- AddForeignKey
ALTER TABLE "TournamentPrize" ADD CONSTRAINT "TournamentPrize_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
