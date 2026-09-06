--
-- PostgreSQL database dump
--






SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: bridge_task_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bridge_task_status AS ENUM (
    'idle',
    'running',
    'completed',
    'error'
);


--
-- Name: briefing_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.briefing_type AS ENUM (
    'morning',
    'evening',
    'weekly',
    'daily-intel',
    'jewelry-changelog',
    'messenger-intel',
    'morning-thought',
    'mid-day-check'
);


--
-- Name: channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.channel AS ENUM (
    'telegram',
    'web',
    'cli'
);


--
-- Name: content_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.content_status AS ENUM (
    'draft',
    'ready',
    'approved',
    'posted',
    'rejected'
);


--
-- Name: entity_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.entity_status AS ENUM (
    'active',
    'archived',
    'hidden'
);


--
-- Name: extraction_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.extraction_status AS ENUM (
    'pending',
    'success',
    'failed',
    'abandoned'
);


--
-- Name: memory_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.memory_scope AS ENUM (
    'foundational',
    'session-active',
    'archived'
);


--
-- Name: memory_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.memory_source AS ENUM (
    'conversation',
    'manual',
    'extraction',
    'synthesis'
);


--
-- Name: memory_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.memory_status AS ENUM (
    'confirmed',
    'pending',
    'rejected'
);


--
-- Name: memory_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.memory_type AS ENUM (
    'fact',
    'decision',
    'pattern',
    'preference',
    'event',
    'goal'
);


--
-- Name: message_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.message_role AS ENUM (
    'user',
    'assistant'
);


--
-- Name: mission_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mission_status AS ENUM (
    'planning',
    'executing',
    'completed',
    'failed',
    'cancelled'
);


--
-- Name: system_event_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.system_event_severity AS ENUM (
    'info',
    'warn',
    'error'
);


--
-- Name: task_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_status AS ENUM (
    'pending',
    'running',
    'completed',
    'failed',
    'repaired'
);


--
-- Name: trade_side; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.trade_side AS ENUM (
    'long',
    'short'
);


--
-- Name: trade_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.trade_status AS ENUM (
    'open',
    'closed',
    'cancelled'
);


--
-- Name: workflow_run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.workflow_run_status AS ENUM (
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: active_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_sessions (
    id text NOT NULL,
    project text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_ping_at timestamp with time zone DEFAULT now() NOT NULL,
    current_file text,
    iterm_session_uuid text,
    current_file_since timestamp with time zone
);


--
-- Name: agent_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent text NOT NULL,
    block_type text NOT NULL,
    reason text NOT NULL,
    needs text,
    context jsonb,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolution_note text
);


--
-- Name: agent_dispatches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_dispatches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_name text NOT NULL,
    dispatched_at timestamp with time zone DEFAULT now() NOT NULL,
    dispatched_by text,
    task_prompt text NOT NULL,
    task_output text NOT NULL,
    findings jsonb,
    tool_calls jsonb,
    tokens_in integer,
    tokens_out integer,
    duration_ms integer,
    model text,
    feedback jsonb,
    archived_at timestamp with time zone,
    status text DEFAULT 'reported'::text NOT NULL,
    verified_at timestamp with time zone,
    verified_by text,
    project text,
    CONSTRAINT agent_dispatches_status_chk CHECK ((status = ANY (ARRAY['reported'::text, 'verified'::text, 'archived'::text, 'failed'::text])))
);


--
-- Name: architect_inbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.architect_inbox (
    id text NOT NULL,
    severity text NOT NULL,
    kind text NOT NULL,
    summary text NOT NULL,
    context_hash text,
    related_dispatch_id text,
    posted_at timestamp with time zone DEFAULT now() NOT NULL,
    dismissed_at timestamp with time zone,
    CONSTRAINT architect_inbox_severity_chk CHECK ((severity = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])))
);


--
-- Name: bodhi_schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bodhi_schema_migrations (
    migration_id text NOT NULL,
    checksum character(64) NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    release_version text NOT NULL,
    outcome text NOT NULL,
    backup_reference text,
    backup_checksum character(64),
    before_fingerprint text,
    after_fingerprint text,
    before_row_counts jsonb,
    after_row_counts jsonb,
    error text,
    CONSTRAINT bodhi_schema_migrations_outcome_check CHECK ((outcome = ANY (ARRAY['applied'::text, 'skipped'::text, 'failed'::text])))
);


--
-- Name: book_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.book_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    book_title text NOT NULL,
    book_author text NOT NULL,
    chapter text,
    page_start integer,
    page_end integer,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    embedding public.vector(1024) NOT NULL,
    tags jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: briefings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.briefings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.briefing_type NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_memory_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    avg_confidence real,
    context_breakdown jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: checkpoint_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checkpoint_id uuid NOT NULL,
    artifact_type text NOT NULL,
    uri text NOT NULL,
    label text,
    sha256 text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT checkpoint_artifacts_sha256_chk CHECK (((sha256 IS NULL) OR (length(sha256) = 64)))
);


--
-- Name: checkpoint_project_provider_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_project_provider_refs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checkpoint_id uuid NOT NULL,
    project_key text NOT NULL,
    provider text NOT NULL,
    native_task_id text NOT NULL,
    host_id text,
    working_directory text,
    task_url text,
    is_primary boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: checkpoint_provider_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_provider_refs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checkpoint_id uuid NOT NULL,
    provider text NOT NULL,
    native_task_id text NOT NULL,
    host_id text,
    working_directory text,
    task_url text,
    is_primary boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: concierge_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concierge_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel public.channel NOT NULL,
    thread_id uuid,
    working_set jsonb DEFAULT '{"taskQueue": [], "activeWatches": [], "notesForDigest": [], "handledSilently": []}'::jsonb NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: content_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lesson_number integer NOT NULL,
    topic text NOT NULL,
    slides jsonb NOT NULL,
    caption text NOT NULL,
    status public.content_status DEFAULT 'draft'::public.content_status NOT NULL,
    feedback_note text,
    posted_at timestamp with time zone,
    post_results jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversation_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel public.channel NOT NULL,
    channel_thread_id text,
    title text,
    summary text,
    extraction_status public.extraction_status,
    extracted_at timestamp with time zone,
    extraction_attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversation_turns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_turns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    role public.message_role NOT NULL,
    content text NOT NULL,
    channel public.channel NOT NULL,
    tool_calls jsonb,
    context_snapshot jsonb,
    token_usage jsonb,
    model_used text,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    feedback jsonb,
    self_assessment jsonb,
    source_event_id text,
    source_timestamp timestamp with time zone
);


--
-- Name: corpus_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corpus_imports (
    packet_id text NOT NULL,
    owner_name text NOT NULL,
    assistant_name text NOT NULL,
    content_hash text NOT NULL,
    reviewed_by text NOT NULL,
    reviewed_at timestamp with time zone NOT NULL,
    source_metadata jsonb NOT NULL,
    file_manifest jsonb NOT NULL,
    imported_counts jsonb NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT corpus_imports_hash_chk CHECK ((length(content_hash) = 64))
);


--
-- Name: entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    aliases jsonb DEFAULT '[]'::jsonb,
    description text,
    importance real DEFAULT 0.5 NOT NULL,
    mention_count integer DEFAULT 0 NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    subtype text,
    status public.entity_status DEFAULT 'active'::public.entity_status NOT NULL
);


--
-- Name: entity_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_memories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_id uuid NOT NULL,
    memory_id uuid NOT NULL,
    role text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: foundation_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.foundation_imports (
    packet_id text NOT NULL,
    owner_name text NOT NULL,
    assistant_name text NOT NULL,
    content_hash text NOT NULL,
    reviewed_by text NOT NULL,
    reviewed_at timestamp with time zone NOT NULL,
    source_metadata jsonb NOT NULL,
    imported_items jsonb NOT NULL,
    imported_counts jsonb NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT foundation_imports_hash_chk CHECK ((length(content_hash) = 64))
);


--
-- Name: goal_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    goal_id uuid NOT NULL,
    cadence text NOT NULL,
    assessment text NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    decisions jsonb DEFAULT '[]'::jsonb NOT NULL,
    next_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT goal_reviews_assessment_chk CHECK ((assessment = ANY (ARRAY['on-track'::text, 'at-risk'::text, 'blocked'::text, 'complete'::text]))),
    CONSTRAINT goal_reviews_cadence_chk CHECK ((cadence = ANY (ARRAY['weekly'::text, 'quarterly'::text])))
);


--
-- Name: library_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    domain text NOT NULL,
    sub_domain text,
    chunk_index integer NOT NULL,
    chunk_text text NOT NULL,
    embedding public.vector(1024) NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: library_search_invocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_search_invocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    query text NOT NULL,
    domain text,
    sub_domain text,
    threshold real,
    limit_n integer,
    hits integer NOT NULL,
    top_similarity real,
    agent_context text DEFAULT 'unknown'::text NOT NULL,
    caller text,
    metadata jsonb,
    retrieved_chunk_ids text[]
);


--
-- Name: memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.memory_type DEFAULT 'fact'::public.memory_type NOT NULL,
    content text NOT NULL,
    embedding public.vector(1024) NOT NULL,
    source public.memory_source DEFAULT 'extraction'::public.memory_source NOT NULL,
    source_thread_id uuid,
    importance real DEFAULT 0.5 NOT NULL,
    confidence real DEFAULT 1 NOT NULL,
    tags jsonb,
    access_count integer DEFAULT 0 NOT NULL,
    last_accessed_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status public.memory_status DEFAULT 'confirmed'::public.memory_status NOT NULL,
    superseded_by uuid,
    recall_count integer DEFAULT 0 NOT NULL,
    last_recalled_at timestamp with time zone,
    forgotten_at timestamp with time zone,
    scope public.memory_scope DEFAULT 'session-active'::public.memory_scope NOT NULL
);


--
-- Name: memory_calibration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_calibration (
    memory_type text NOT NULL,
    total_sampled integer DEFAULT 0 NOT NULL,
    total_correct integer DEFAULT 0 NOT NULL,
    bias_scale double precision DEFAULT 0 NOT NULL,
    scale_scale double precision DEFAULT 1 NOT NULL,
    last_updated timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: parked_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parked_items (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    title text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    origin_kind text DEFAULT 'free'::text NOT NULL,
    origin_ref text,
    trigger jsonb NOT NULL,
    auto_close jsonb,
    review_by timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
    status text DEFAULT 'parked'::text NOT NULL,
    closed_reason text,
    resurfaced_reason text,
    parked_at timestamp with time zone DEFAULT now() NOT NULL,
    resurfaced_at timestamp with time zone,
    closed_at timestamp with time zone,
    surfaced_close_at timestamp with time zone,
    created_by text,
    CONSTRAINT parked_items_closed_reason_chk CHECK (((closed_reason IS NULL) OR (closed_reason = ANY (ARRAY['done'::text, 'moot'::text, 'expired_review'::text])))),
    CONSTRAINT parked_items_origin_chk CHECK ((origin_kind = ANY (ARRAY['memory'::text, 'cron'::text, 'dispatch'::text, 'inbox'::text, 'free'::text]))),
    CONSTRAINT parked_items_status_chk CHECK ((status = ANY (ARRAY['parked'::text, 'resurfaced'::text, 'closed'::text])))
);


--
-- Name: personal_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personal_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_key text NOT NULL,
    title text NOT NULL,
    outcome text NOT NULL,
    success_criteria jsonb DEFAULT '[]'::jsonb NOT NULL,
    constraints jsonb DEFAULT '[]'::jsonb NOT NULL,
    priority integer DEFAULT 3 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    target_date timestamp with time zone,
    observation_scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_weekly_review_at timestamp with time zone,
    last_quarterly_review_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT personal_goals_priority_chk CHECK (((priority >= 1) AND (priority <= 5))),
    CONSTRAINT personal_goals_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text, 'abandoned'::text])))
);


--
-- Name: personal_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personal_opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_key text NOT NULL,
    goal_id uuid,
    title text NOT NULL,
    observation text NOT NULL,
    why_now text NOT NULL,
    proposed_action text NOT NULL,
    expected_value text NOT NULL,
    risk text NOT NULL,
    action_class text,
    approval_required boolean DEFAULT true NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    content_hash text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    checkpoint_id uuid,
    parked_item_id text,
    resolution_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT personal_opportunities_hash_chk CHECK ((length(content_hash) = 64)),
    CONSTRAINT personal_opportunities_risk_chk CHECK ((risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT personal_opportunities_status_chk CHECK ((status = ANY (ARRAY['open'::text, 'accepted'::text, 'in_progress'::text, 'parked'::text, 'dismissed'::text, 'completed'::text]))),
    CONSTRAINT personal_opportunities_value_chk CHECK ((expected_value = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
);


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    html_content text NOT NULL,
    options jsonb,
    action_class text,
    related_dispatch_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    feedback_json jsonb,
    resolved_at timestamp with time zone,
    proposed_by text
);


--
-- Name: pulse_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pulse_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic_id uuid,
    source_url text NOT NULL,
    title text NOT NULL,
    summary text,
    sources jsonb,
    uncertainty text NOT NULL,
    score integer,
    sighting_count integer DEFAULT 1 NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    embedding public.vector(1024)
);


--
-- Name: research_briefings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_briefings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic text NOT NULL,
    lang text DEFAULT 'mn'::text NOT NULL,
    title text NOT NULL,
    body_md text NOT NULL,
    source_finding_ids jsonb,
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: research_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question text NOT NULL,
    source_url text NOT NULL,
    title text NOT NULL,
    summary text,
    sources jsonb,
    uncertainty text NOT NULL,
    score integer,
    claim_supported numeric,
    source_reachable boolean,
    verdict_floor boolean,
    verify_model text,
    sighting_count integer DEFAULT 1 NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    embedding public.vector(1024)
);


--
-- Name: research_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_labels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question text NOT NULL,
    source_url text NOT NULL,
    label text NOT NULL,
    label_source text NOT NULL,
    labeled_by text,
    rationale text,
    labeled_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: research_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    questions integer,
    findings_total integer,
    findings_verified integer,
    sources_reachable_pct numeric,
    claims_verified_pct numeric,
    citation_accuracy numeric,
    verify_enabled boolean,
    verify_model text,
    sonar_enabled boolean
);


--
-- Name: review_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    text text NOT NULL,
    source_kind text NOT NULL,
    source_ref text,
    proposed_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decision text,
    decision_note text,
    surfaces_until timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL
);


--
-- Name: session_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_session text NOT NULL,
    to_session text,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    content_hash text,
    kind text DEFAULT 'broadcast'::text NOT NULL,
    acknowledged boolean DEFAULT false NOT NULL,
    acknowledged_at timestamp with time zone,
    expires_at timestamp with time zone,
    delivered_to jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: skill_learning_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_learning_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_key text NOT NULL,
    target_skill text NOT NULL,
    change_type text NOT NULL,
    learning_key text NOT NULL,
    title text NOT NULL,
    proposed_change text NOT NULL,
    severity text NOT NULL,
    status text DEFAULT 'candidate'::text NOT NULL,
    occurrence_count integer NOT NULL,
    evidence_snapshots jsonb DEFAULT '[]'::jsonb NOT NULL,
    resolution_reason text,
    materialized_checkpoint_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT skill_learning_candidates_change_chk CHECK ((change_type = ANY (ARRAY['update'::text, 'split'::text, lower(('mer'::text || 'ge'::text)), 'retire'::text, 'new-skill'::text, 'agent-evaluation'::text]))),
    CONSTRAINT skill_learning_candidates_occurrences_chk CHECK ((occurrence_count >= 1)),
    CONSTRAINT skill_learning_candidates_severity_chk CHECK ((severity = ANY (ARRAY['ordinary'::text, 'material'::text, 'critical'::text]))),
    CONSTRAINT skill_learning_candidates_status_chk CHECK ((status = ANY (ARRAY['candidate'::text, 'approved'::text, 'dismissed'::text, 'materialized'::text])))
);


--
-- Name: skill_learning_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_learning_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_id uuid NOT NULL,
    signal_type text NOT NULL,
    learning_key text NOT NULL,
    change_type text NOT NULL,
    severity text NOT NULL,
    summary text NOT NULL,
    content_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_learning_signals_change_chk CHECK ((change_type = ANY (ARRAY['update'::text, 'split'::text, lower(('mer'::text || 'ge'::text)), 'retire'::text, 'new-skill'::text, 'agent-evaluation'::text]))),
    CONSTRAINT skill_learning_signals_hash_chk CHECK ((length(content_hash) = 64)),
    CONSTRAINT skill_learning_signals_severity_chk CHECK ((severity = ANY (ARRAY['ordinary'::text, 'material'::text, 'critical'::text]))),
    CONSTRAINT skill_learning_signals_type_chk CHECK ((signal_type = ANY (ARRAY['correction'::text, 'rejection'::text, 'workaround'::text, 'routing-miss'::text, 'missing-context'::text, 'stale-reference'::text, 'quality-gap'::text, 'verification-failure'::text, 'safety-failure'::text, 'agent-boundary'::text])))
);


--
-- Name: skill_run_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_run_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_key text NOT NULL,
    provider text NOT NULL,
    native_task_id text NOT NULL,
    checkpoint_id uuid,
    skill_name text NOT NULL,
    skill_scope text NOT NULL,
    skill_hash text NOT NULL,
    result_disposition text NOT NULL,
    verification_state text NOT NULL,
    external_skill_dependencies jsonb DEFAULT '[]'::jsonb NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_run_receipts_hash_chk CHECK ((length(skill_hash) = 64)),
    CONSTRAINT skill_run_receipts_result_chk CHECK ((result_disposition = ANY (ARRAY['accepted'::text, 'revised'::text, 'discarded'::text, 'failed'::text]))),
    CONSTRAINT skill_run_receipts_scope_chk CHECK ((skill_scope = ANY (ARRAY['repo'::text, 'user'::text]))),
    CONSTRAINT skill_run_receipts_verification_chk CHECK ((verification_state = ANY (ARRAY['passed'::text, 'failed'::text, 'not-required'::text, 'unverified'::text])))
);


--
-- Name: skill_usage_rollups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_usage_rollups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_key text NOT NULL,
    skill_name text NOT NULL,
    skill_hash text NOT NULL,
    period_start timestamp with time zone NOT NULL,
    task_uses integer DEFAULT 0 NOT NULL,
    accepted_count integer DEFAULT 0 NOT NULL,
    revised_count integer DEFAULT 0 NOT NULL,
    discarded_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    correction_count integer DEFAULT 0 NOT NULL,
    workaround_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_usage_rollups_counts_chk CHECK (((task_uses >= 0) AND (accepted_count >= 0) AND (revised_count >= 0) AND (discarded_count >= 0) AND (failed_count >= 0) AND (correction_count >= 0) AND (workaround_count >= 0))),
    CONSTRAINT skill_usage_rollups_hash_chk CHECK ((length(skill_hash) = 64))
);


--
-- Name: system_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_audit (
    id text NOT NULL,
    kind text NOT NULL,
    actor text NOT NULL,
    target text,
    payload_hash text,
    payload_length integer,
    metadata jsonb,
    ts timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    kind text NOT NULL,
    summary text NOT NULL,
    severity public.system_event_severity DEFAULT 'info'::public.system_event_severity NOT NULL,
    payload jsonb,
    acknowledged_at timestamp with time zone
);


--
-- Name: trust_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trust_tiers (
    action_class text NOT NULL,
    tier text NOT NULL,
    set_at timestamp with time zone DEFAULT now() NOT NULL,
    note text,
    set_by text,
    CONSTRAINT tier_valid CHECK ((tier = ANY (ARRAY['auto-do'::text, 'notify'::text, 'await'::text])))
);


--
-- Name: verification_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checkpoint_id uuid NOT NULL,
    claim text NOT NULL,
    expected_signal text NOT NULL,
    observed_signal text,
    evidence_source text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT verification_receipts_observed_signal_chk CHECK (((status = 'pending'::text) OR (observed_signal IS NOT NULL))),
    CONSTRAINT verification_receipts_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'passed'::text, 'failed'::text])))
);


--
-- Name: work_checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_checkpoints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schema_version integer DEFAULT 2 NOT NULL,
    project_key text NOT NULL,
    objective text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    decisions jsonb DEFAULT '[]'::jsonb NOT NULL,
    next_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    entity_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    parent_checkpoint_id uuid,
    remaining_work_disposition text,
    completion_verification_state text,
    content_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    goal_id uuid,
    opportunity_id uuid,
    pattern_key text,
    outcome_metrics jsonb,
    CONSTRAINT work_checkpoints_completion_fields_chk CHECK (((state <> 'completed'::text) OR ((completed_at IS NOT NULL) AND (remaining_work_disposition IS NOT NULL) AND (completion_verification_state IS NOT NULL)))),
    CONSTRAINT work_checkpoints_completion_verification_chk CHECK (((completion_verification_state IS NULL) OR (completion_verification_state = ANY (ARRAY['passed'::text, 'failed'::text, 'not-required'::text])))),
    CONSTRAINT work_checkpoints_content_hash_chk CHECK ((length(content_hash) = 64)),
    CONSTRAINT work_checkpoints_remaining_disposition_chk CHECK (((remaining_work_disposition IS NULL) OR (remaining_work_disposition = ANY (ARRAY['none'::text, 'deferred'::text, 'abandoned'::text])))),
    CONSTRAINT work_checkpoints_schema_version_chk CHECK ((schema_version > 0)),
    CONSTRAINT work_checkpoints_state_chk CHECK ((state = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text, 'abandoned'::text])))
);


--
-- Name: workflow_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_key text NOT NULL,
    pattern_key text NOT NULL,
    summary text NOT NULL,
    qualifying_checkpoint_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    successful_runs integer NOT NULL,
    status text DEFAULT 'candidate'::text NOT NULL,
    resolution_reason text,
    materialized_checkpoint_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT workflow_candidates_runs_chk CHECK ((successful_runs >= 3)),
    CONSTRAINT workflow_candidates_status_chk CHECK ((status = ANY (ARRAY['candidate'::text, 'approved'::text, 'dismissed'::text, 'materialized'::text])))
);


--
-- Name: active_sessions active_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_sessions
    ADD CONSTRAINT active_sessions_pkey PRIMARY KEY (id);


--
-- Name: agent_blocks agent_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_blocks
    ADD CONSTRAINT agent_blocks_pkey PRIMARY KEY (id);


--
-- Name: agent_dispatches agent_dispatches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_dispatches
    ADD CONSTRAINT agent_dispatches_pkey PRIMARY KEY (id);


--
-- Name: architect_inbox architect_inbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.architect_inbox
    ADD CONSTRAINT architect_inbox_pkey PRIMARY KEY (id);


--
-- Name: bodhi_schema_migrations bodhi_schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bodhi_schema_migrations
    ADD CONSTRAINT bodhi_schema_migrations_pkey PRIMARY KEY (migration_id, applied_at);


--
-- Name: book_chunks book_chunks_book_title_chunk_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_chunks
    ADD CONSTRAINT book_chunks_book_title_chunk_index_key UNIQUE (book_title, chunk_index);


--
-- Name: book_chunks book_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_chunks
    ADD CONSTRAINT book_chunks_pkey PRIMARY KEY (id);


--
-- Name: briefings briefings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefings
    ADD CONSTRAINT briefings_pkey PRIMARY KEY (id);


--
-- Name: checkpoint_artifacts checkpoint_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_artifacts
    ADD CONSTRAINT checkpoint_artifacts_pkey PRIMARY KEY (id);


--
-- Name: checkpoint_project_provider_refs checkpoint_project_provider_refs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_project_provider_refs
    ADD CONSTRAINT checkpoint_project_provider_refs_pkey PRIMARY KEY (id);


--
-- Name: checkpoint_provider_refs checkpoint_provider_refs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_provider_refs
    ADD CONSTRAINT checkpoint_provider_refs_pkey PRIMARY KEY (id);


--
-- Name: concierge_state concierge_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concierge_state
    ADD CONSTRAINT concierge_state_pkey PRIMARY KEY (id);


--
-- Name: content_queue content_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_queue
    ADD CONSTRAINT content_queue_pkey PRIMARY KEY (id);


--
-- Name: conversation_threads conversation_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_threads
    ADD CONSTRAINT conversation_threads_pkey PRIMARY KEY (id);


--
-- Name: conversation_turns conversation_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turns
    ADD CONSTRAINT conversation_turns_pkey PRIMARY KEY (id);


--
-- Name: corpus_imports corpus_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corpus_imports
    ADD CONSTRAINT corpus_imports_pkey PRIMARY KEY (packet_id);


--
-- Name: entities entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);


--
-- Name: entity_memories entity_memories_entity_id_memory_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_memories
    ADD CONSTRAINT entity_memories_entity_id_memory_id_key UNIQUE (entity_id, memory_id);


--
-- Name: entity_memories entity_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_memories
    ADD CONSTRAINT entity_memories_pkey PRIMARY KEY (id);


--
-- Name: foundation_imports foundation_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foundation_imports
    ADD CONSTRAINT foundation_imports_pkey PRIMARY KEY (packet_id);


--
-- Name: goal_reviews goal_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_reviews
    ADD CONSTRAINT goal_reviews_pkey PRIMARY KEY (id);


--
-- Name: library_entries library_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_entries
    ADD CONSTRAINT library_entries_pkey PRIMARY KEY (id);


--
-- Name: library_entries library_entries_source_chunk_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_entries
    ADD CONSTRAINT library_entries_source_chunk_index_key UNIQUE (source, chunk_index);


--
-- Name: library_search_invocations library_search_invocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_search_invocations
    ADD CONSTRAINT library_search_invocations_pkey PRIMARY KEY (id);


--
-- Name: memories memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_pkey PRIMARY KEY (id);


--
-- Name: memory_calibration memory_calibration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_calibration
    ADD CONSTRAINT memory_calibration_pkey PRIMARY KEY (memory_type);


--
-- Name: parked_items parked_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parked_items
    ADD CONSTRAINT parked_items_pkey PRIMARY KEY (id);


--
-- Name: personal_goals personal_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_goals
    ADD CONSTRAINT personal_goals_pkey PRIMARY KEY (id);


--
-- Name: personal_opportunities personal_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_opportunities
    ADD CONSTRAINT personal_opportunities_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: pulse_findings pulse_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pulse_findings
    ADD CONSTRAINT pulse_findings_pkey PRIMARY KEY (id);


--
-- Name: research_briefings research_briefings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_briefings
    ADD CONSTRAINT research_briefings_pkey PRIMARY KEY (id);


--
-- Name: research_findings research_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_findings
    ADD CONSTRAINT research_findings_pkey PRIMARY KEY (id);


--
-- Name: research_labels research_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_labels
    ADD CONSTRAINT research_labels_pkey PRIMARY KEY (id);


--
-- Name: research_runs research_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_runs
    ADD CONSTRAINT research_runs_pkey PRIMARY KEY (id);


--
-- Name: review_items review_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_items
    ADD CONSTRAINT review_items_pkey PRIMARY KEY (id);


--
-- Name: session_messages session_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_messages
    ADD CONSTRAINT session_messages_pkey PRIMARY KEY (id);


--
-- Name: skill_learning_candidates skill_learning_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_learning_candidates
    ADD CONSTRAINT skill_learning_candidates_pkey PRIMARY KEY (id);


--
-- Name: skill_learning_signals skill_learning_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_learning_signals
    ADD CONSTRAINT skill_learning_signals_pkey PRIMARY KEY (id);


--
-- Name: skill_run_receipts skill_run_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_run_receipts
    ADD CONSTRAINT skill_run_receipts_pkey PRIMARY KEY (id);


--
-- Name: skill_usage_rollups skill_usage_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_usage_rollups
    ADD CONSTRAINT skill_usage_rollups_pkey PRIMARY KEY (id);


--
-- Name: system_audit system_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_audit
    ADD CONSTRAINT system_audit_pkey PRIMARY KEY (id);


--
-- Name: system_events system_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_events
    ADD CONSTRAINT system_events_pkey PRIMARY KEY (id);


--
-- Name: trust_tiers trust_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trust_tiers
    ADD CONSTRAINT trust_tiers_pkey PRIMARY KEY (action_class);


--
-- Name: verification_receipts verification_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_receipts
    ADD CONSTRAINT verification_receipts_pkey PRIMARY KEY (id);


--
-- Name: work_checkpoints work_checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_checkpoints
    ADD CONSTRAINT work_checkpoints_pkey PRIMARY KEY (id);


--
-- Name: workflow_candidates workflow_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_candidates
    ADD CONSTRAINT workflow_candidates_pkey PRIMARY KEY (id);


--
-- Name: agent_blocks_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_blocks_agent_idx ON public.agent_blocks USING btree (agent, created_at DESC);


--
-- Name: agent_blocks_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_blocks_open_idx ON public.agent_blocks USING btree (created_at DESC) WHERE (status = 'open'::text);


--
-- Name: agent_dispatches_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_dispatches_active_idx ON public.agent_dispatches USING btree (agent_name, dispatched_at DESC) WHERE (archived_at IS NULL);


--
-- Name: agent_dispatches_agent_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_dispatches_agent_ts_idx ON public.agent_dispatches USING btree (agent_name, dispatched_at DESC);


--
-- Name: agent_dispatches_dispatched_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_dispatches_dispatched_by_idx ON public.agent_dispatches USING btree (dispatched_by) WHERE (dispatched_by IS NOT NULL);


--
-- Name: agent_dispatches_findings_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_dispatches_findings_gin_idx ON public.agent_dispatches USING gin (findings);


--
-- Name: agent_dispatches_pending_verify_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_dispatches_pending_verify_idx ON public.agent_dispatches USING btree (agent_name, dispatched_at DESC) WHERE ((status = 'reported'::text) AND (archived_at IS NULL));


--
-- Name: agent_dispatches_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_dispatches_project_idx ON public.agent_dispatches USING btree (project);


--
-- Name: agent_dispatches_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_dispatches_ts_idx ON public.agent_dispatches USING btree (dispatched_at DESC);


--
-- Name: architect_inbox_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX architect_inbox_pending_idx ON public.architect_inbox USING btree (severity, posted_at DESC) WHERE (dismissed_at IS NULL);


--
-- Name: bodhi_schema_migrations_latest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bodhi_schema_migrations_latest_idx ON public.bodhi_schema_migrations USING btree (migration_id, applied_at DESC);


--
-- Name: book_chunks_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX book_chunks_embedding_hnsw_idx ON public.book_chunks USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: book_chunks_tags_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX book_chunks_tags_gin ON public.book_chunks USING gin (tags);


--
-- Name: book_chunks_title_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX book_chunks_title_idx ON public.book_chunks USING btree (book_title);


--
-- Name: checkpoint_artifacts_checkpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkpoint_artifacts_checkpoint_idx ON public.checkpoint_artifacts USING btree (checkpoint_id);


--
-- Name: checkpoint_artifacts_checkpoint_uri_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX checkpoint_artifacts_checkpoint_uri_uidx ON public.checkpoint_artifacts USING btree (checkpoint_id, uri);


--
-- Name: checkpoint_project_provider_refs_checkpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkpoint_project_provider_refs_checkpoint_idx ON public.checkpoint_project_provider_refs USING btree (checkpoint_id);


--
-- Name: checkpoint_project_provider_refs_native_project_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX checkpoint_project_provider_refs_native_project_uidx ON public.checkpoint_project_provider_refs USING btree (provider, native_task_id, project_key);


--
-- Name: checkpoint_project_provider_refs_primary_provider_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX checkpoint_project_provider_refs_primary_provider_uidx ON public.checkpoint_project_provider_refs USING btree (checkpoint_id, provider) WHERE (is_primary = true);


--
-- Name: checkpoint_provider_refs_checkpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkpoint_provider_refs_checkpoint_idx ON public.checkpoint_provider_refs USING btree (checkpoint_id);


--
-- Name: checkpoint_provider_refs_native_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX checkpoint_provider_refs_native_uidx ON public.checkpoint_provider_refs USING btree (provider, native_task_id);


--
-- Name: checkpoint_provider_refs_primary_provider_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX checkpoint_provider_refs_primary_provider_uidx ON public.checkpoint_provider_refs USING btree (checkpoint_id, provider) WHERE (is_primary = true);


--
-- Name: concierge_state_channel_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX concierge_state_channel_unique ON public.concierge_state USING btree (channel);


--
-- Name: conversation_threads_unextracted_cli_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_threads_unextracted_cli_idx ON public.conversation_threads USING btree (last_active_at) WHERE ((channel = 'cli'::public.channel) AND (extracted_at IS NULL));


--
-- Name: conversation_turns_source_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX conversation_turns_source_event_id_idx ON public.conversation_turns USING btree (source_event_id) WHERE (source_event_id IS NOT NULL);


--
-- Name: conversation_turns_source_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_turns_source_timestamp_idx ON public.conversation_turns USING btree (source_timestamp DESC) WHERE (source_timestamp IS NOT NULL);


--
-- Name: conversation_turns_thread_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_turns_thread_created_idx ON public.conversation_turns USING btree (thread_id, created_at DESC);


--
-- Name: corpus_imports_owner_imported_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX corpus_imports_owner_imported_idx ON public.corpus_imports USING btree (owner_name, imported_at DESC);


--
-- Name: entities_type_subtype_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entities_type_subtype_idx ON public.entities USING btree (type, subtype);


--
-- Name: foundation_imports_owner_imported_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX foundation_imports_owner_imported_idx ON public.foundation_imports USING btree (owner_name, imported_at DESC);


--
-- Name: goal_reviews_goal_reviewed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goal_reviews_goal_reviewed_idx ON public.goal_reviews USING btree (goal_id, reviewed_at DESC);


--
-- Name: idx_entities_aliases_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entities_aliases_gin ON public.entities USING gin (aliases);


--
-- Name: idx_entities_mention_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entities_mention_count ON public.entities USING btree (mention_count DESC);


--
-- Name: idx_entities_name_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entities_name_lower ON public.entities USING btree (lower(name));


--
-- Name: idx_entities_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entities_type ON public.entities USING btree (type);


--
-- Name: idx_entity_memories_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_memories_entity ON public.entity_memories USING btree (entity_id);


--
-- Name: idx_entity_memories_entity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_memories_entity_id ON public.entity_memories USING btree (entity_id);


--
-- Name: idx_entity_memories_memory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_memories_memory ON public.entity_memories USING btree (memory_id);


--
-- Name: idx_entity_memories_memory_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_memories_memory_id ON public.entity_memories USING btree (memory_id);


--
-- Name: idx_memories_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memories_status ON public.memories USING btree (status) WHERE (status = 'pending'::public.memory_status);


--
-- Name: idx_memories_superseded_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memories_superseded_by ON public.memories USING btree (superseded_by) WHERE (superseded_by IS NOT NULL);


--
-- Name: idx_session_messages_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_messages_created ON public.session_messages USING btree (created_at);


--
-- Name: library_entries_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX library_entries_domain_idx ON public.library_entries USING btree (domain, sub_domain);


--
-- Name: library_entries_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX library_entries_embedding_hnsw_idx ON public.library_entries USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: library_entries_metadata_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX library_entries_metadata_gin ON public.library_entries USING gin (metadata);


--
-- Name: library_entries_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX library_entries_source_idx ON public.library_entries USING btree (source);


--
-- Name: library_search_invocations_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX library_search_invocations_agent_idx ON public.library_search_invocations USING btree (agent_context);


--
-- Name: library_search_invocations_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX library_search_invocations_domain_idx ON public.library_search_invocations USING btree (domain, sub_domain);


--
-- Name: library_search_invocations_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX library_search_invocations_ts_idx ON public.library_search_invocations USING btree (ts DESC);


--
-- Name: memories_cold_tier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memories_cold_tier_idx ON public.memories USING btree (created_at, recall_count, importance) WHERE (forgotten_at IS NULL);


--
-- Name: memories_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memories_embedding_hnsw_idx ON public.memories USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: memories_status_type_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memories_status_type_created_idx ON public.memories USING btree (status, type, created_at DESC);


--
-- Name: parked_items_origin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parked_items_origin_idx ON public.parked_items USING btree (origin_kind, origin_ref);


--
-- Name: parked_items_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parked_items_status_idx ON public.parked_items USING btree (status);


--
-- Name: personal_goals_project_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personal_goals_project_status_idx ON public.personal_goals USING btree (project_key, status, priority);


--
-- Name: personal_goals_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personal_goals_review_idx ON public.personal_goals USING btree (last_weekly_review_at, last_quarterly_review_at);


--
-- Name: personal_opportunities_checkpoint_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX personal_opportunities_checkpoint_uidx ON public.personal_opportunities USING btree (checkpoint_id) WHERE (checkpoint_id IS NOT NULL);


--
-- Name: personal_opportunities_goal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personal_opportunities_goal_idx ON public.personal_opportunities USING btree (goal_id, status);


--
-- Name: personal_opportunities_project_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personal_opportunities_project_status_idx ON public.personal_opportunities USING btree (project_key, status, created_at DESC);


--
-- Name: personal_opportunities_unresolved_hash_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX personal_opportunities_unresolved_hash_uidx ON public.personal_opportunities USING btree (project_key, content_hash) WHERE (status = ANY (ARRAY['open'::text, 'accepted'::text, 'in_progress'::text, 'parked'::text]));


--
-- Name: pulse_findings_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pulse_findings_last_seen_idx ON public.pulse_findings USING btree (last_seen);


--
-- Name: pulse_findings_source_url_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pulse_findings_source_url_unique ON public.pulse_findings USING btree (source_url);


--
-- Name: pulse_findings_topic_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pulse_findings_topic_id_idx ON public.pulse_findings USING btree (topic_id);


--
-- Name: research_briefings_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_briefings_created_at_idx ON public.research_briefings USING btree (created_at);


--
-- Name: research_findings_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_findings_last_seen_idx ON public.research_findings USING btree (last_seen);


--
-- Name: research_findings_question_source_url_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX research_findings_question_source_url_unique ON public.research_findings USING btree (question, source_url);


--
-- Name: research_labels_labeled_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_labels_labeled_at_idx ON public.research_labels USING btree (labeled_at);


--
-- Name: research_labels_question_source_url_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX research_labels_question_source_url_unique ON public.research_labels USING btree (question, source_url);


--
-- Name: research_runs_run_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_runs_run_at_idx ON public.research_runs USING btree (run_at);


--
-- Name: review_items_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_items_pending_idx ON public.review_items USING btree (proposed_at DESC) WHERE (decision IS NULL);


--
-- Name: skill_learning_candidates_pattern_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX skill_learning_candidates_pattern_uidx ON public.skill_learning_candidates USING btree (project_key, target_skill, change_type, learning_key);


--
-- Name: skill_learning_candidates_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_learning_candidates_status_idx ON public.skill_learning_candidates USING btree (status, severity, updated_at DESC);


--
-- Name: skill_learning_signals_pattern_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_learning_signals_pattern_idx ON public.skill_learning_signals USING btree (learning_key, change_type, created_at DESC);


--
-- Name: skill_learning_signals_receipt_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX skill_learning_signals_receipt_key_uidx ON public.skill_learning_signals USING btree (receipt_id, signal_type, learning_key, content_hash);


--
-- Name: skill_run_receipts_checkpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_run_receipts_checkpoint_idx ON public.skill_run_receipts USING btree (checkpoint_id) WHERE (checkpoint_id IS NOT NULL);


--
-- Name: skill_run_receipts_project_completed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_run_receipts_project_completed_idx ON public.skill_run_receipts USING btree (project_key, completed_at DESC);


--
-- Name: skill_run_receipts_skill_completed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_run_receipts_skill_completed_idx ON public.skill_run_receipts USING btree (skill_name, completed_at DESC);


--
-- Name: skill_run_receipts_task_skill_hash_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX skill_run_receipts_task_skill_hash_uidx ON public.skill_run_receipts USING btree (provider, native_task_id, skill_name, skill_hash);


--
-- Name: skill_usage_rollups_period_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX skill_usage_rollups_period_uidx ON public.skill_usage_rollups USING btree (project_key, skill_name, skill_hash, period_start);


--
-- Name: skill_usage_rollups_skill_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_usage_rollups_skill_period_idx ON public.skill_usage_rollups USING btree (skill_name, period_start DESC);


--
-- Name: system_audit_actor_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_audit_actor_ts ON public.system_audit USING btree (actor, ts DESC);


--
-- Name: system_audit_kind_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_audit_kind_ts ON public.system_audit USING btree (kind, ts DESC);


--
-- Name: system_events_ts_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_events_ts_kind_idx ON public.system_events USING btree (ts DESC, kind);


--
-- Name: system_events_unacked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_events_unacked_idx ON public.system_events USING btree (ts DESC) WHERE (acknowledged_at IS NULL);


--
-- Name: verification_receipts_checkpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verification_receipts_checkpoint_idx ON public.verification_receipts USING btree (checkpoint_id);


--
-- Name: verification_receipts_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verification_receipts_pending_idx ON public.verification_receipts USING btree (status, observed_at);


--
-- Name: work_checkpoints_entity_ids_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_checkpoints_entity_ids_gin_idx ON public.work_checkpoints USING gin (entity_ids);


--
-- Name: work_checkpoints_goal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_checkpoints_goal_idx ON public.work_checkpoints USING btree (goal_id, state, updated_at DESC);


--
-- Name: work_checkpoints_id_project_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX work_checkpoints_id_project_uidx ON public.work_checkpoints USING btree (id, project_key);


--
-- Name: work_checkpoints_opportunity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_checkpoints_opportunity_idx ON public.work_checkpoints USING btree (opportunity_id) WHERE (opportunity_id IS NOT NULL);


--
-- Name: work_checkpoints_pattern_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_checkpoints_pattern_idx ON public.work_checkpoints USING btree (project_key, pattern_key, state) WHERE (pattern_key IS NOT NULL);


--
-- Name: work_checkpoints_project_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_checkpoints_project_state_idx ON public.work_checkpoints USING btree (project_key, state, updated_at);


--
-- Name: work_checkpoints_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_checkpoints_updated_at_idx ON public.work_checkpoints USING btree (updated_at);


--
-- Name: workflow_candidates_project_pattern_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workflow_candidates_project_pattern_uidx ON public.workflow_candidates USING btree (project_key, pattern_key);


--
-- Name: workflow_candidates_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_candidates_status_idx ON public.workflow_candidates USING btree (status, updated_at DESC);


--
-- Name: checkpoint_artifacts checkpoint_artifacts_checkpoint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_artifacts
    ADD CONSTRAINT checkpoint_artifacts_checkpoint_id_fkey FOREIGN KEY (checkpoint_id) REFERENCES public.work_checkpoints(id) ON DELETE CASCADE;


--
-- Name: checkpoint_project_provider_refs checkpoint_project_provider_refs_checkpoint_project_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_project_provider_refs
    ADD CONSTRAINT checkpoint_project_provider_refs_checkpoint_project_fkey FOREIGN KEY (checkpoint_id, project_key) REFERENCES public.work_checkpoints(id, project_key) ON DELETE CASCADE;


--
-- Name: checkpoint_provider_refs checkpoint_provider_refs_checkpoint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_provider_refs
    ADD CONSTRAINT checkpoint_provider_refs_checkpoint_id_fkey FOREIGN KEY (checkpoint_id) REFERENCES public.work_checkpoints(id) ON DELETE CASCADE;


--
-- Name: concierge_state concierge_state_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concierge_state
    ADD CONSTRAINT concierge_state_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.conversation_threads(id) ON DELETE SET NULL;


--
-- Name: conversation_turns conversation_turns_thread_id_conversation_threads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turns
    ADD CONSTRAINT conversation_turns_thread_id_conversation_threads_id_fk FOREIGN KEY (thread_id) REFERENCES public.conversation_threads(id) ON DELETE CASCADE;


--
-- Name: entity_memories entity_memories_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_memories
    ADD CONSTRAINT entity_memories_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: entity_memories entity_memories_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_memories
    ADD CONSTRAINT entity_memories_memory_id_fkey FOREIGN KEY (memory_id) REFERENCES public.memories(id) ON DELETE CASCADE;


--
-- Name: goal_reviews goal_reviews_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_reviews
    ADD CONSTRAINT goal_reviews_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.personal_goals(id) ON DELETE CASCADE;


--
-- Name: memories memories_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.memories(id);


--
-- Name: personal_opportunities personal_opportunities_checkpoint_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_opportunities
    ADD CONSTRAINT personal_opportunities_checkpoint_fk FOREIGN KEY (checkpoint_id) REFERENCES public.work_checkpoints(id) ON DELETE SET NULL;


--
-- Name: personal_opportunities personal_opportunities_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_opportunities
    ADD CONSTRAINT personal_opportunities_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.personal_goals(id) ON DELETE SET NULL;


--
-- Name: personal_opportunities personal_opportunities_parked_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_opportunities
    ADD CONSTRAINT personal_opportunities_parked_fk FOREIGN KEY (parked_item_id) REFERENCES public.parked_items(id) ON DELETE SET NULL;


--
-- Name: skill_learning_candidates skill_learning_candidates_materialized_checkpoint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_learning_candidates
    ADD CONSTRAINT skill_learning_candidates_materialized_checkpoint_id_fkey FOREIGN KEY (materialized_checkpoint_id) REFERENCES public.work_checkpoints(id) ON DELETE SET NULL;


--
-- Name: skill_learning_signals skill_learning_signals_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_learning_signals
    ADD CONSTRAINT skill_learning_signals_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.skill_run_receipts(id) ON DELETE CASCADE;


--
-- Name: skill_run_receipts skill_run_receipts_checkpoint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_run_receipts
    ADD CONSTRAINT skill_run_receipts_checkpoint_id_fkey FOREIGN KEY (checkpoint_id) REFERENCES public.work_checkpoints(id) ON DELETE SET NULL;


--
-- Name: verification_receipts verification_receipts_checkpoint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_receipts
    ADD CONSTRAINT verification_receipts_checkpoint_id_fkey FOREIGN KEY (checkpoint_id) REFERENCES public.work_checkpoints(id) ON DELETE CASCADE;


--
-- Name: work_checkpoints work_checkpoints_goal_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_checkpoints
    ADD CONSTRAINT work_checkpoints_goal_fk FOREIGN KEY (goal_id) REFERENCES public.personal_goals(id) ON DELETE SET NULL;


--
-- Name: work_checkpoints work_checkpoints_opportunity_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_checkpoints
    ADD CONSTRAINT work_checkpoints_opportunity_fk FOREIGN KEY (opportunity_id) REFERENCES public.personal_opportunities(id) ON DELETE SET NULL;


--
-- Name: work_checkpoints work_checkpoints_parent_checkpoint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_checkpoints
    ADD CONSTRAINT work_checkpoints_parent_checkpoint_id_fkey FOREIGN KEY (parent_checkpoint_id) REFERENCES public.work_checkpoints(id) ON DELETE SET NULL;


--
-- Name: workflow_candidates workflow_candidates_materialized_checkpoint_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_candidates
    ADD CONSTRAINT workflow_candidates_materialized_checkpoint_fk FOREIGN KEY (materialized_checkpoint_id) REFERENCES public.work_checkpoints(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--



