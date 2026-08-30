import { prisma } from './src/lib/prisma';

async function main() {
  try {
    console.log('Creating profiles table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "profiles" (
          "id" UUID NOT NULL,
          "user_id" UUID NOT NULL,
          "email" TEXT NOT NULL,
          "role" TEXT NOT NULL DEFAULT 'user',
          "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" TIMESTAMP(3) NOT NULL,

          CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
      );
    `);
    
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "profiles_user_id_key" ON "profiles"("user_id");
    `);

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "profiles_email_key" ON "profiles"("email");
    `);

    console.log('Successfully created profiles table!');
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
