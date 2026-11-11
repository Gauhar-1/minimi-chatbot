import type { IMemoryWriter } from '@/core/contracts/memory.contract';

/**
 * Known tech & SaaS entities for deterministic regex matching.
 */
const KNOWN_ENTITIES = [
  'HubSpot',
  'Attio',
  'Pipedrive',
  'Close',
  'Salesforce',
  'Supabase',
  'Neon',
  'AWS RDS',
  'Render',
  'PostgreSQL',
  'Pinecone',
  'Weaviate',
  'Qdrant',
  'Docker',
  'Redis',
  'SQLite',
];

/**
 * Extracts atomic entities, constraints, and pricing figures from turn text.
 */
export function extractEntitiesAndConstraints(prompt: string, reply: string): {
  entities: string[];
  pricing: string[];
  constraints: string[];
} {
  const combined = `${prompt} ${reply}`;
  const entities = new Set<string>();

  for (const entity of KNOWN_ENTITIES) {
    const regex = new RegExp(`\\b${entity}\\b`, 'i');
    if (regex.test(combined)) {
      entities.add(entity);
    }
  }

  // Extract currency pricing figures (e.g., $90/seat, $25/mo, $0.15/GB)
  const pricingMatches = combined.match(/\$\d+(\.\d+)?(\/(seat|mo|month|GB|hour|hr|yr|year|user))?/gi) || [];
  const pricing = Array.from(new Set(pricingMatches)).slice(0, 10);

  // Extract common user constraints (e.g., "20-person sales team", "20 seats", "5 CRMs")
  const constraints: string[] = [];
  const teamMatch = combined.match(/\b\d+[- ](person|seat|user|rep|developer)\b/gi);
  if (teamMatch) {
    constraints.push(...teamMatch);
  }
  const toolCountMatch = combined.match(/\b\d+\s+(crm|tools|providers|databases|options)\b/gi);
  if (toolCountMatch) {
    constraints.push(...toolCountMatch);
  }

  return {
    entities: Array.from(entities),
    pricing,
    constraints: Array.from(new Set(constraints)),
  };
}

/**
 * Asynchronous post-turn fact extraction and persistence.
 *
 * Distills atomic facts (shortlisted tools, baseline prices, user constraints, dates)
 * from completed conversation turns and saves them to session_facts with local vector embeddings.
 * Wrapped in try/catch so background compaction never interrupts or crashes the user stream.
 */
export async function extractAndSaveTurnFacts(
  sessionId: string,
  userPrompt: string,
  assistantReply: string,
  writer: IMemoryWriter,
  referenceDateUtc: string = new Date().toISOString()
): Promise<string[]> {
  try {
    const { entities, pricing, constraints } = extractEntitiesAndConstraints(
      userPrompt,
      assistantReply
    );

    const cleanPrompt = userPrompt.replace(/\s+/g, ' ').trim().slice(0, 150);
    const firstReplySentence = assistantReply
      .split(/[.!\n]/)[0]
      ?.replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);

    const factsToSave: Array<{ text: string; entities: string[] }> = [];

    // Fact 1: User interaction summary
    const entityTag = entities.length > 0 ? ` [Entities: ${entities.join(', ')}]` : '';
    const constraintTag = constraints.length > 0 ? ` [Constraints: ${constraints.join(', ')}]` : '';
    const fact1Text = `User asked: "${cleanPrompt}". Outcome: ${firstReplySentence || 'Technical evaluation completed.'}.${entityTag}${constraintTag}`;
    factsToSave.push({ text: fact1Text, entities });

    // Fact 2: Concrete baseline pricing if pricing figures were discussed
    if (entities.length > 0 && pricing.length > 0) {
      const fact2Text = `Baseline pricing at T0 for ${entities.slice(0, 5).join(', ')}: ${pricing.slice(0, 5).join(', ')}${constraintTag}`;
      factsToSave.push({ text: fact2Text, entities });
    }

    const savedIds: string[] = [];
    for (const item of factsToSave) {
      const id = await writer.saveFact({
        sessionId,
        factText: item.text,
        entitiesJson: JSON.stringify(item.entities),
        referenceDateUtc,
      });
      savedIds.push(id);
    }

    return savedIds;
  } catch (err) {
    console.warn(
      '[FactCompactor] Background fact compaction encountered a non-critical error:',
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

export class FactCompactor {
  private writer: IMemoryWriter;

  constructor(writer: IMemoryWriter) {
    this.writer = writer;
  }

  public async compactTurnAsync(
    sessionId: string,
    userPrompt: string,
    assistantReply: string,
    referenceDateUtc: string = new Date().toISOString()
  ): Promise<string | null> {
    const ids = await extractAndSaveTurnFacts(
      sessionId,
      userPrompt,
      assistantReply,
      this.writer,
      referenceDateUtc
    );
    return ids[0] || null;
  }
}
