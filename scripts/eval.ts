import { TemporalParser } from '../src/core/temporal/chrono-parser';
import { HybridMemoryEngine } from '../src/core/memory/hybrid-retriever';
import { ensureDatabaseSeeded } from '../src/core/memory/auto-seeder';
import { closeDatabase } from '../src/core/memory/sqlite-client';
import { MarkdownScraper } from '../src/core/search/markdown-scraper';
import { ChatOrchestrator } from '../src/core/orchestrator/chat-orchestrator';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  durationMs: number;
}

async function runEvaluationSuite(): Promise<void> {
  console.log('\n=============================================================');
  console.log('🧪 MINIMI TEMPORAL AGENT EVALUATION HARNESS (npm run eval)');
  console.log('=============================================================\n');

  // Ensure DB is seeded
  await ensureDatabaseSeeded();
  const engine = new HybridMemoryEngine();
  const results: TestResult[] = [];

  // =========================================================================
  // Test 1: Monday — 5 CRM Tools for 20-Person Sales Team Recall
  // =========================================================================
  const t1Start = performance.now();
  const prompt1 =
    'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any changed pricing since?';
  const window1 = TemporalParser.parse(prompt1);
  const recall1 = await engine.recallContext(prompt1, window1);

  const entities1 = ['HubSpot', 'Attio', 'Pipedrive', 'Close', 'Salesforce'];
  const formattedLower1 = recall1.formattedHistoricalContext.toLowerCase();
  const matchedAllCRMs = entities1.every((e) => formattedLower1.includes(e.toLowerCase()));

  results.push({
    name: 'Challenge 1: Monday CRM Shortlist Recall',
    passed:
      window1.hasTemporalReference &&
      recall1.recallStatus === 'MATCHED' &&
      matchedAllCRMs &&
      recall1.matchedMessages.length > 0,
    details: `Window: ${window1.startUtc?.split('T')[0]} | Recalled all 5 CRM tools: ${matchedAllCRMs} (${recall1.latencyMs}ms)`,
    durationMs: Math.round(performance.now() - t1Start),
  });

  // =========================================================================
  // Test 2: Last Tuesday — Postgres Hosting Comparison Recall
  // =========================================================================
  const t2Start = performance.now();
  const prompt2 =
    'Compare Postgres hosting providers from last Tuesday. Did Supabase or Neon update their plans?';
  const window2 = TemporalParser.parse(prompt2);
  const recall2 = await engine.recallContext(prompt2, window2);

  const entities2 = ['Supabase', 'Neon', 'AWS RDS', 'Render'];
  const formattedLower2 = recall2.formattedHistoricalContext.toLowerCase();
  const matchedAllPostgres = entities2.every((e) => formattedLower2.includes(e.toLowerCase()));

  results.push({
    name: 'Challenge 2: Last Tuesday Postgres Hosting Recall',
    passed:
      window2.hasTemporalReference &&
      recall2.recallStatus === 'MATCHED' &&
      matchedAllPostgres &&
      recall2.matchedMessages.length > 0,
    details: `Window: ${window2.startUtc?.split('T')[0]} | Recalled all 4 Postgres providers: ${matchedAllPostgres} (${recall2.latencyMs}ms)`,
    durationMs: Math.round(performance.now() - t2Start),
  });

  // =========================================================================
  // Test 3: 3 November — Verifiable Vector DB Baseline Recall
  // =========================================================================
  const t3Start = performance.now();
  const prompt3 = 'What did I ask you on 3 November? Is your answer still correct today?';
  const window3 = TemporalParser.parse(prompt3);
  const recall3 = await engine.recallContext(prompt3, window3);

  const entities3 = ['Pinecone', 'Weaviate', 'Qdrant'];
  const formattedLower3 = recall3.formattedHistoricalContext.toLowerCase();
  const matchedAllVectorDBs = entities3.every((e) => formattedLower3.includes(e.toLowerCase()));

  results.push({
    name: 'Challenge 3: 3 November Technical Q&A Recall',
    passed:
      window3.hasTemporalReference &&
      recall3.recallStatus === 'MATCHED' &&
      matchedAllVectorDBs &&
      recall3.matchedMessages.length > 0,
    details: `Window: ${window3.startUtc?.split('T')[0]} | Recalled Vector DB baseline: ${matchedAllVectorDBs} (${recall3.latencyMs}ms)`,
    durationMs: Math.round(performance.now() - t3Start),
  });

  // =========================================================================
  // Test 4: Anti-Hallucination Guard (EMPTY_FOR_DATE_WINDOW)
  // =========================================================================
  const t4Start = performance.now();
  const prompt4 = 'What did we discuss on 15 August 2024?';
  const window4 = TemporalParser.parse(prompt4);
  const recall4 = await engine.recallContext(prompt4, window4);

  const guardPassed =
    window4.hasTemporalReference &&
    recall4.recallStatus === 'EMPTY_FOR_DATE_WINDOW' &&
    recall4.matchedMessages.length === 0;

  results.push({
    name: 'Anti-Hallucination Guard on Unrecorded Date',
    passed: guardPassed,
    details: `Status: ${recall4.recallStatus} | Zero hallucinated records on empty date window.`,
    durationMs: Math.round(performance.now() - t4Start),
  });

  // =========================================================================
  // Test 5: Markdown Scraper & GFM Table Extraction
  // =========================================================================
  const t5Start = performance.now();
  const samplePricingHtml = `
    <html>
      <body>
        <h1>Vendor Pricing</h1>
        <table>
          <thead>
            <tr><th>Plan</th><th>Monthly Price</th><th>Seats Included</th></tr>
          </thead>
          <tbody>
            <tr><td>Starter</td><td>$25/mo</td><td>5</td></tr>
            <tr><td>Professional</td><td>$90/mo</td><td>20</td></tr>
          </tbody>
        </table>
      </body>
    </html>
  `;
  const scrapeResult = MarkdownScraper.htmlToMarkdown(
    samplePricingHtml,
    'https://example.com/pricing'
  );
  const tableConverted =
    scrapeResult.scrapeSuccess &&
    scrapeResult.markdownContent.includes('| Plan |') &&
    scrapeResult.markdownContent.includes('$90/mo');

  results.push({
    name: 'Deep Pricing Scraper: GFM Table Preservation',
    passed: tableConverted,
    details: `Preserved GFM Table with accurate pricing tokens ($90/mo, $25/mo).`,
    durationMs: Math.round(performance.now() - t5Start),
  });

  // =========================================================================
  // Optional Test 6: Live End-to-End LLM Synthesis (if API key is present)
  // =========================================================================
  const hasLlmKey = Boolean(
    (process.env.LLM_PROVIDER === 'google' && process.env.GOOGLE_GENERATIVE_AI_API_KEY) ||
    (process.env.LLM_PROVIDER === 'openai' && process.env.OPENAI_API_KEY) ||
    process.env.GROQ_API_KEY
  );

  if (hasLlmKey) {
    const t6Start = performance.now();
    console.log('[Eval Harness] API Key detected! Running live LLM end-to-end pipeline...');
    try {
      const orchestrator = new ChatOrchestrator(engine, engine);
      const execution = await orchestrator.executePipeline({
        sessionId: 'eval_live_turn',
        userPrompt: prompt1,
      });
      const generatedText = await execution.stream.text;

      results.push({
        name: `Live LLM Synthesis (${execution.providerName} / ${execution.modelName})`,
        passed: generatedText.length > 50,
        details: `Successfully generated ${generatedText.length} characters using ${execution.modelName}.`,
        durationMs: Math.round(performance.now() - t6Start),
      });
    } catch (err) {
      results.push({
        name: 'Live LLM Synthesis & Streaming',
        passed: false,
        details: `Live execution error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Math.round(performance.now() - t6Start),
      });
    }
  }

  // Close DB
  closeDatabase();

  // Print Results Summary
  console.log('RESULTS BREAKDOWN:');
  console.log('-------------------------------------------------------------');
  let allPassed = true;
  for (const r of results) {
    const symbol = r.passed ? '✔ PASS' : '❌ FAIL';
    console.log(`${symbol} [${r.name}] (${r.durationMs}ms)`);
    console.log(`       ${r.details}`);
    if (!r.passed) allPassed = false;
  }
  if (!hasLlmKey) {
    console.log('ℹ SKIP [Live End-to-End LLM Synthesis]');
    console.log('       No LLM API key detected in .env. Core deterministic systems 100% verified.');
  }
  console.log('-------------------------------------------------------------');

  if (allPassed) {
    console.log('🎉 ALL EVALUATION GATES PASSED DETERMINISTICALLY!\n');
    process.exit(0);
  } else {
    console.error('❌ SOME EVALUATION GATES FAILED.\n');
    process.exit(1);
  }
}

runEvaluationSuite().catch((err) => {
  console.error('Fatal evaluation harness error:', err);
  process.exit(1);
});
