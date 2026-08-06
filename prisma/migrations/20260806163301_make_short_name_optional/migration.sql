-- AlterTable
ALTER TABLE "categories" ALTER COLUMN "short_name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "departments" ALTER COLUMN "short_name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sub_categories" ALTER COLUMN "short_name" DROP NOT NULL;
