-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Decision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "memberId" TEXT NOT NULL,
    "messageId" TEXT,
    "action" TEXT NOT NULL,
    "addressedTo" TEXT NOT NULL,
    "interest" INTEGER NOT NULL,
    "trust" INTEGER NOT NULL,
    "reasoning" TEXT NOT NULL,
    "whisper" TEXT NOT NULL DEFAULT '',
    "adaptation" TEXT NOT NULL DEFAULT 'steady',
    CONSTRAINT "Decision_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Decision" ("action", "addressedTo", "createdAt", "id", "interest", "memberId", "messageId", "reasoning", "round", "sessionId", "trust") SELECT "action", "addressedTo", "createdAt", "id", "interest", "memberId", "messageId", "reasoning", "round", "sessionId", "trust" FROM "Decision";
DROP TABLE "Decision";
ALTER TABLE "new_Decision" RENAME TO "Decision";
CREATE INDEX "Decision_sessionId_createdAt_idx" ON "Decision"("sessionId", "createdAt");
CREATE TABLE "new_Scorecard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "report" TEXT NOT NULL,
    "verdict" TEXT NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL,
    CONSTRAINT "Scorecard_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Scorecard" ("createdAt", "id", "model", "overall", "report", "sessionId") SELECT "createdAt", "id", "model", "overall", "report", "sessionId" FROM "Scorecard";
DROP TABLE "Scorecard";
ALTER TABLE "new_Scorecard" RENAME TO "Scorecard";
CREATE UNIQUE INDEX "Scorecard_sessionId_key" ON "Scorecard"("sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
