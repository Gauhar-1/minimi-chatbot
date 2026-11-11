import { ensureDatabaseSeeded } from '../src/core/memory/auto-seeder';
import { closeDatabase } from '../src/core/memory/sqlite-client';

async function main(): Promise<void> {
  const force = process.argv.includes('--force') || process.argv.includes('-f');
  console.log(`[Seed Script] Initializing SQLite database seeding (force=${force})...`);

  try {
    const result = await ensureDatabaseSeeded(force);
    if (result.seeded) {
      console.log(' Seeding completed successfully!');
      console.log(`   - Total Messages: ${result.messageCount}`);
      console.log(`   - Total Distilled Facts: ${result.factCount}`);
      console.log(`   - Sessions: ${result.sessionsSeeded.join(', ')}`);
      console.log('   - Anchored Timestamps:');
      for (const [k, v] of Object.entries(result.referenceDates)) {
        console.log(`     * ${k}: ${v}`);
      }
    } else {
      console.log(`ℹ Database is already seeded (${result.messageCount} messages, ${result.factCount} facts).`);
      console.log('   Run `npm run seed -- --force` to reset and re-seed.');
    }
  } catch (err) {
    console.error('❌ Failed to seed database:', err);
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

main();

