import type Database from 'better-sqlite3';
import { getDatabase, resetDatabase } from './sqlite-client';
import { LocalEmbedder } from './local-embedder';
import { TemporalParser } from '@/core/temporal/chrono-parser';

export interface SeedResult {
  seeded: boolean;
  messageCount: number;
  factCount: number;
  sessionsSeeded: string[];
  referenceDates: Record<string, string>;
}

/**
 * Computes deterministic relative ISO timestamps anchored to the host's current clock.
 */
export function computeSeedTimestamps(now: Date = new Date()): {
  mondayTimestampUtc: string;
  lastTuesdayTimestampUtc: string;
  nov3TimestampUtc: string;
} {
  // 1. Monday timestamp: Anchor to TemporalParser's resolution of "On Monday"
  const mondayParsed = TemporalParser.parse('On Monday', now);
  let mondayDate: Date;
  if (mondayParsed.startUtc) {
    mondayDate = new Date(mondayParsed.startUtc);
  } else {
    // Fallback: 2 to 7 days ago
    const dayOfWeek = now.getUTCDay();
    const daysAgo = dayOfWeek === 1 ? 7 : (dayOfWeek + 6) % 7;
    mondayDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  }
  mondayDate.setUTCHours(14, 0, 0, 0);

  // 2. Last Tuesday timestamp: Anchor to TemporalParser's resolution of "last Tuesday"
  const tuesdayParsed = TemporalParser.parse('last Tuesday', now);
  let tuesdayDate: Date;
  if (tuesdayParsed.startUtc) {
    tuesdayDate = new Date(tuesdayParsed.startUtc);
  } else {
    // Fallback: 8 days ago
    tuesdayDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
  }
  tuesdayDate.setUTCHours(15, 30, 0, 0);

  // 3. 3 November timestamp: Anchor to TemporalParser's resolution of "3 November"
  const nov3Parsed = TemporalParser.parse('3 November', now);
  let nov3Date: Date;
  if (nov3Parsed.startUtc) {
    nov3Date = new Date(nov3Parsed.startUtc);
  } else {
    // Fallback: most recent past November 3
    const currentYear = now.getUTCFullYear();
    const thisYearNov3 = new Date(Date.UTC(currentYear, 10, 3, 11, 0, 0));
    nov3Date = thisYearNov3 > now ? new Date(Date.UTC(currentYear - 1, 10, 3, 11, 0, 0)) : thisYearNov3;
  }
  nov3Date.setUTCHours(11, 15, 0, 0);

  return {
    mondayTimestampUtc: mondayDate.toISOString(),
    lastTuesdayTimestampUtc: tuesdayDate.toISOString(),
    nov3TimestampUtc: nov3Date.toISOString(),
  };
}

/**
 * Ensures the SQLite database contains the 3 historical sessions required by
 * the Minimi Hiring Challenge evaluators. Idempotent: Skips if messages exist,
 * unless force=true is passed.
 */
export async function ensureDatabaseSeeded(force = false): Promise<SeedResult> {
  const db: Database.Database = force ? resetDatabase() : getDatabase();

  if (!force) {
    const existing = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
    if (existing && existing.count > 0) {
      const factCount = (db.prepare('SELECT COUNT(*) as count FROM session_facts').get() as { count: number }).count;
      return {
        seeded: false,
        messageCount: existing.count,
        factCount,
        sessionsSeeded: [],
        referenceDates: {},
      };
    }
  }

  const now = new Date();
  const { mondayTimestampUtc, lastTuesdayTimestampUtc, nov3TimestampUtc } = computeSeedTimestamps(now);

  console.log('[AutoSeeder] Seeding relative historical sessions anchored to clock:');
  console.log(`  - "Monday"       -> ${mondayTimestampUtc}`);
  console.log(`  - "Last Tuesday" -> ${lastTuesdayTimestampUtc}`);
  console.log(`  - "3 November"   -> ${nov3TimestampUtc}`);

  const defaultUserId = 'usr_evaluator';

  // Prepared insert statements
  const insertSession = db.prepare(
    `INSERT OR REPLACE INTO sessions (id, user_id, title, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?)`
  );

  const insertMsg = db.prepare(
    `INSERT INTO messages (id, user_id, session_id, role, content, created_at_utc, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const insertFact = db.prepare(
    `INSERT INTO session_facts (id, user_id, session_id, fact_text, entities_json, reference_date_utc, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  // =========================================================================
  // Session 1: Monday — 5 CRM Tools for 20-Person Sales Team
  // =========================================================================
  const mondaySessionId = 'session_crm_monday';
  const mondayUserPrompt =
    'We are shortlisting CRM tools for our 20-person sales team. Can you recommend 5 top modern CRMs with exact per-seat pricing, pipeline automation, and total monthly cost for 20 seats?';

  const mondayAssistantReply = `Here is our shortlisted selection of 5 CRM platforms tailored for a 20-person sales team, with their current baseline pricing ($T_0$) and core features:

1. **HubSpot Sales Hub (Professional)**
   - **Per-Seat Pricing:** $90/seat/month (billed annually) or $100/seat/month (billed monthly).
   - **20-Person Monthly Baseline:** $1,800/month (annual commitment) or $2,000/month (monthly).
   - **Key Features:** Automated multi-step outreach sequences, deal pipelines, custom report builder, phone integration, and electronic signatures.

2. **Attio (Pro Tier)**
   - **Per-Seat Pricing:** $59/seat/month (billed annually) or $79/seat/month (billed monthly). (Entry 'Plus' tier is $29/seat/mo).
   - **20-Person Monthly Baseline:** $1,180/month (annual).
   - **Key Features:** Real-time data enrichment, custom data model & relationship tracking, automated email sync, configurable pipeline views.

3. **Pipedrive (Advanced / Professional)**
   - **Per-Seat Pricing:** Advanced at $27.90/seat/month; Professional at $49.90/seat/month (billed annually).
   - **20-Person Monthly Baseline:** $998/month on Professional tier ($558/month on Advanced).
   - **Key Features:** Visual Kanban deal pipeline, automated workflow actions, smart contact data, revenue forecasting.

4. **Close (Professional Tier)**
   - **Per-Seat Pricing:** $99/seat/month (billed annually) or $109/seat/month (billed monthly). (Basic tier is $49/seat/mo).
   - **20-Person Monthly Baseline:** $1,980/month.
   - **Key Features:** Built-in multi-channel calling, SMS and power dialer, high-velocity email sequences, workflow automation for inside sales.

5. **Salesforce Starter & Pro Suite**
   - **Per-Seat Pricing:** Starter Suite at $25/seat/month; Pro Suite at $100/seat/month (billed annually).
   - **20-Person Monthly Baseline:** $500/month (Starter) or $2,000/month (Pro Suite).
   - **Key Features:** Standard lead and contact management, built-in sales email templates, basic Einstein AI activity capture, unified service & sales ticketing.

**Summary Recommendation:**
For a 20-person sales team, Attio offers the most flexible modern data model at $1,180/month, while HubSpot Sales Hub Pro ($1,800/month) and Close Pro ($1,980/month) provide the most comprehensive outbound sequence automation.`;

  // =========================================================================
  // Session 2: Last Tuesday — Postgres Hosting Comparison
  // =========================================================================
  const tuesdaySessionId = 'session_postgres_tuesday';
  const tuesdayUserPrompt =
    'We need to choose a managed Postgres hosting provider for our new production service. Can you compare Supabase Pro, Neon, AWS RDS, and Render Postgres with exact compute, RAM, and storage pricing tiers?';

  const tuesdayAssistantReply = `Here is our production comparison of 4 managed PostgreSQL hosting providers with baseline pricing recorded at $T_0$:

1. **Supabase Pro**
   - **Base Tier:** $25/month flat fee (includes 8GB disk storage, 100,000 monthly active users, 2-core shared CPU, 500MB egress).
   - **Compute Add-ons:** Small (2GB RAM, 2-core shared) +$10/mo; Medium (4GB RAM, 2 vCPU dedicated) +$60/mo; Large (8GB RAM, 2 vCPU dedicated) +$110/mo up to 64GB RAM.
   - **Storage Overages:** $0.125 per GB-month beyond included 8GB.

2. **Neon (Serverless Postgres)**
   - **Launch Tier:** $19/month (includes 10 Compute Hours, 10GB storage, 1 project).
   - **Scale Tier:** $69/month (includes 50 Compute Hours, autoscaling from 0.25 CU to 8 CU, 50GB storage, point-in-time restore for 14 days).
   - **Storage Overages:** $0.15 per GB-month beyond included storage.

3. **AWS RDS for PostgreSQL**
   - **Compute (On-Demand us-east-1):** db.t4g.small (2 vCPU, 2GB RAM) at ~$0.034/hr (~$25/mo); db.t4g.medium (2 vCPU, 4GB RAM) at ~$0.068/hr (~$49/mo); db.m6g.large (2 vCPU, 8GB RAM) at ~$0.154/hr (~$111/mo).
   - **Storage:** General Purpose gp3 storage at $0.115 per GB-month (baseline 3,000 IOPS and 125 MB/s throughput included).

4. **Render Postgres**
   - **Starter Tier:** $7/month (0.5 shared CPU, 1GB RAM, 10GB SSD).
   - **Standard Tier:** $20/month (1 shared CPU, 2GB RAM, 50GB SSD).
   - **Pro Tier:** $35/month (2 dedicated vCPU, 4GB RAM, 100GB SSD).
   - **Additional Storage:** $0.30 per GB-month.

**Verdict:** For serverless scaling with instant branching, Neon Scale ($69/mo); for full BaaS integration with Auth & Storage, Supabase Pro ($25/mo); for enterprise VPC compliance, AWS RDS.`;

  // =========================================================================
  // Session 3: 3 November — Verifiable Vector DB Baseline
  // =========================================================================
  const nov3SessionId = 'session_nov3_vectordb';
  const nov3UserPrompt =
    'What are the top 3 vector databases for our real-time RAG pipeline—specifically Pinecone Serverless, Weaviate Cloud, and Qdrant Cloud? Give me their exact pricing and capacity limits as of today.';

  const nov3AssistantReply = `As of November 3 ($T_0$), here is the exact pricing architecture and capacity comparison for Pinecone Serverless, Weaviate Cloud, and Qdrant Cloud:

1. **Pinecone Serverless**
   - **Read Units (RU):** $0.25 per 1,000,000 Read Units.
   - **Write Units (WU):** $0.33 per 1,000,000 Write Units.
   - **Storage:** $0.33 per GB per month.
   - **Characteristics:** Decoupled storage and compute; scales to zero with zero minimum hourly cluster fee.

2. **Weaviate Cloud (WCD)**
   - **Serverless Tier:** Starts at $0.085 per 1,000,000 vector dimensions per month for storage and search.
   - **Dedicated Clusters:** Starting from $280/month for high-availability enterprise production clusters (SLA included).
   - **Characteristics:** Native multi-modal vector support with built-in hybrid BM25 + dense vector ranking.

3. **Qdrant Cloud**
   - **Managed Clusters:** Starts at $25/month for 1 node (1GB RAM, 0.5 vCPU, ~100,000 vectors with 384 dimensions).
   - **Standard Production Node:** $75/month (4GB RAM, 1 vCPU).
   - **Characteristics:** Written in Rust, memory-mapped vector on-disk payloads, sub-millisecond filtering with boolean payload constraints.

**Verdict as of November 3:** Pinecone Serverless is most cost-effective for bursty/sporadic traffic, while Qdrant Cloud ($25/mo starter) provides deterministic low-latency for always-on microservices.`;

  // Compute all embeddings in parallel
  console.log('[AutoSeeder] Generating vector embeddings for historical turns...');
  const [
    embedMondayUser,
    embedMondayAssistant,
    embedTuesdayUser,
    embedTuesdayAssistant,
    embedNov3User,
    embedNov3Assistant,
    embedFactCrm1,
    embedFactCrm2,
    embedFactPostgres1,
    embedFactVector1,
  ] = await Promise.all([
    LocalEmbedder.embed(mondayUserPrompt),
    LocalEmbedder.embed(mondayAssistantReply),
    LocalEmbedder.embed(tuesdayUserPrompt),
    LocalEmbedder.embed(tuesdayAssistantReply),
    LocalEmbedder.embed(nov3UserPrompt),
    LocalEmbedder.embed(nov3AssistantReply),
    LocalEmbedder.embed(
      'Shortlisted 5 CRM platforms for 20-person sales team: HubSpot Sales Hub Pro ($90/seat/mo), Attio Pro ($59/seat/mo), Pipedrive Pro ($49.90/seat/mo), Close Pro ($99/seat/mo), Salesforce Starter ($25/seat/mo) / Pro Suite ($100/seat/mo).'
    ),
    LocalEmbedder.embed(
      'Sales team constraints: 20 sales representatives, deal pipeline automation, custom reporting, and CRM outbound sequencing.'
    ),
    LocalEmbedder.embed(
      'Evaluated managed Postgres providers: Supabase Pro ($25/mo base + compute add-ons), Neon Scale ($69/mo), AWS RDS PostgreSQL (db.t4g.medium ~$49/mo + gp3), Render Postgres Standard ($20/mo) / Pro ($35/mo).'
    ),
    LocalEmbedder.embed(
      'Vector database comparison on November 3: Pinecone Serverless ($0.25/1M RU, $0.33/1M WU, $0.33/GB storage), Weaviate Cloud ($0.085/1M dim/mo), and Qdrant Cloud ($25/mo starter node).'
    ),
  ]);

  // Execute database transaction
  const seedTx = db.transaction(() => {
    // 0. Seed real sidebar sessions for the evaluator
    insertSession.run(
      mondaySessionId,
      defaultUserId,
      'CRM Shortlist (20-Person Sales Team)',
      mondayTimestampUtc,
      new Date(new Date(mondayTimestampUtc).getTime() + 15000).toISOString()
    );

    insertSession.run(
      tuesdaySessionId,
      defaultUserId,
      'Postgres Hosting Comparison',
      lastTuesdayTimestampUtc,
      new Date(new Date(lastTuesdayTimestampUtc).getTime() + 12000).toISOString()
    );

    insertSession.run(
      nov3SessionId,
      defaultUserId,
      'Nov 3 Architecture & Pricing Q&A',
      nov3TimestampUtc,
      new Date(new Date(nov3TimestampUtc).getTime() + 18000).toISOString()
    );

    // 1. Monday Session
    insertMsg.run(
      'msg_monday_user_01',
      defaultUserId,
      mondaySessionId,
      'user',
      mondayUserPrompt,
      mondayTimestampUtc,
      LocalEmbedder.vectorToBlob(embedMondayUser)
    );
    insertMsg.run(
      'msg_monday_assistant_01',
      defaultUserId,
      mondaySessionId,
      'assistant',
      mondayAssistantReply,
      new Date(new Date(mondayTimestampUtc).getTime() + 15000).toISOString(),
      LocalEmbedder.vectorToBlob(embedMondayAssistant)
    );

    insertFact.run(
      'fact_crm_01',
      defaultUserId,
      mondaySessionId,
      'Shortlisted 5 CRM platforms for 20-person sales team: HubSpot Sales Hub Pro ($90/seat/mo), Attio Pro ($59/seat/mo), Pipedrive Pro ($49.90/seat/mo), Close Pro ($99/seat/mo), Salesforce Starter ($25/seat/mo) / Pro Suite ($100/seat/mo).',
      JSON.stringify(['HubSpot', 'Attio', 'Pipedrive', 'Close', 'Salesforce']),
      mondayTimestampUtc,
      LocalEmbedder.vectorToBlob(embedFactCrm1)
    );
    insertFact.run(
      'fact_crm_02',
      defaultUserId,
      mondaySessionId,
      'Sales team constraints: 20 sales representatives, deal pipeline automation, custom reporting, and CRM outbound sequencing.',
      JSON.stringify(['Sales Team', 'Pricing', 'CRM']),
      mondayTimestampUtc,
      LocalEmbedder.vectorToBlob(embedFactCrm2)
    );

    // 2. Tuesday Session
    insertMsg.run(
      'msg_tuesday_user_01',
      defaultUserId,
      tuesdaySessionId,
      'user',
      tuesdayUserPrompt,
      lastTuesdayTimestampUtc,
      LocalEmbedder.vectorToBlob(embedTuesdayUser)
    );
    insertMsg.run(
      'msg_tuesday_assistant_01',
      defaultUserId,
      tuesdaySessionId,
      'assistant',
      tuesdayAssistantReply,
      new Date(new Date(lastTuesdayTimestampUtc).getTime() + 12000).toISOString(),
      LocalEmbedder.vectorToBlob(embedTuesdayAssistant)
    );

    insertFact.run(
      'fact_postgres_01',
      defaultUserId,
      tuesdaySessionId,
      'Evaluated managed Postgres providers: Supabase Pro ($25/mo base + compute add-ons), Neon Scale ($69/mo), AWS RDS PostgreSQL (db.t4g.medium ~$49/mo + gp3), Render Postgres Standard ($20/mo) / Pro ($35/mo).',
      JSON.stringify(['Supabase', 'Neon', 'AWS RDS', 'Render', 'PostgreSQL']),
      lastTuesdayTimestampUtc,
      LocalEmbedder.vectorToBlob(embedFactPostgres1)
    );

    // 3. Nov 3 Session
    insertMsg.run(
      'msg_nov3_user_01',
      defaultUserId,
      nov3SessionId,
      'user',
      nov3UserPrompt,
      nov3TimestampUtc,
      LocalEmbedder.vectorToBlob(embedNov3User)
    );
    insertMsg.run(
      'msg_nov3_assistant_01',
      defaultUserId,
      nov3SessionId,
      'assistant',
      nov3AssistantReply,
      new Date(new Date(nov3TimestampUtc).getTime() + 18000).toISOString(),
      LocalEmbedder.vectorToBlob(embedNov3Assistant)
    );

    insertFact.run(
      'fact_vector_01',
      defaultUserId,
      nov3SessionId,
      'Vector database comparison on November 3: Pinecone Serverless ($0.25/1M RU, $0.33/1M WU, $0.33/GB storage), Weaviate Cloud ($0.085/1M dim/mo), and Qdrant Cloud ($25/mo starter node).',
      JSON.stringify(['Pinecone', 'Weaviate', 'Qdrant', 'Vector Database']),
      nov3TimestampUtc,
      LocalEmbedder.vectorToBlob(embedFactVector1)
    );
  });

  seedTx();

  const totalMessages = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }).count;
  const totalFacts = (db.prepare('SELECT COUNT(*) as count FROM session_facts').get() as { count: number }).count;

  console.log(`[AutoSeeder] Successfully seeded ${totalMessages} messages and ${totalFacts} atomic facts.`);

  return {
    seeded: true,
    messageCount: totalMessages,
    factCount: totalFacts,
    sessionsSeeded: [mondaySessionId, tuesdaySessionId, nov3SessionId],
    referenceDates: {
      monday: mondayTimestampUtc,
      lastTuesday: lastTuesdayTimestampUtc,
      nov3: nov3TimestampUtc,
    },
  };
}
