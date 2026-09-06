// ============================================================
// BODHI — Entity Graph Schema (Drizzle ORM)
// People, projects, topics linked to memories
// ============================================================

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  jsonb,
  real,
  integer,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Lifecycle tier for an entity. `archived` rows are excluded from the graph,
// the list API, and the every-turn AI context — used to demote extraction
// noise (code symbols) without deleting the rows. Default 'active'.
export const entityStatusEnum = pgEnum("entity_status", [
  "active",
  "archived",
  "hidden",
]);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: text("type").notNull(), // person | project | topic | organization | place
    subtype: text("subtype"), // optional second-level (see packages/memory/src/entity-taxonomy.ts)
    aliases: jsonb("aliases").$type<string[]>(),
    description: text("description"),
    importance: real("importance").notNull().default(0.5),
    mentionCount: integer("mention_count").notNull().default(0),
    status: entityStatusEnum("status").notNull().default("active"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_entities_name_lower").on(sql`LOWER(${t.name})`),
    index("idx_entities_aliases_gin").using("gin", t.aliases),
    index("idx_entities_mention_count").on(t.mentionCount.desc()),
    index("entities_type_subtype_idx").on(t.type, t.subtype),
  ]
);

// Junction table: links entities to memories
// Note: memoryId FK to memories.id added via SQL (avoids drizzle-kit cross-file import issue)
export const entityMemories = pgTable(
  "entity_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    memoryId: uuid("memory_id").notNull(),
    role: text("role"), // subject | mentioned | related
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.entityId, t.memoryId),
    index("idx_entity_memories_entity_id").on(t.entityId),
    index("idx_entity_memories_memory_id").on(t.memoryId),
  ]
);
