CREATE TYPE "public"."action_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."action_type" AS ENUM('reply_public', 'reply_private', 'hide', 'unhide', 'delete', 'like', 'unlike', 'assign', 'status_change', 'tag', 'untag');--> statement-breakpoint
CREATE TYPE "public"."ai_job_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."comment_status" AS ENUM('new', 'in_progress', 'replied', 'resolved', 'ignored', 'archived');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('active', 'needs_reauth', 'revoked', 'error', 'paused');--> statement-breakpoint
CREATE TYPE "public"."intent_label" AS ENUM('question', 'complaint', 'praise', 'purchase_intent', 'support_request', 'suggestion', 'spam', 'troll', 'off_topic', 'other');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'manager', 'agent', 'analyst');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('facebook', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."sentiment_label" AS ENUM('very_negative', 'negative', 'neutral', 'positive', 'very_positive');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('organic_post', 'reel', 'story', 'video', 'live', 'ad_comment', 'album', 'other');--> statement-breakpoint
CREATE TYPE "public"."urgency_label" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" numeric,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'agent' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"locale" text DEFAULT 'pt-BR' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_budget_usd" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"password_hash" text,
	"email_verified" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"currency" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"external_ad_id" text NOT NULL,
	"name" text,
	"status" text,
	"campaign_id" text,
	"campaign_name" text,
	"adset_id" text,
	"adset_name" text,
	"creative_id" text,
	"effective_object_story_id" text,
	"effective_instagram_media_id" text,
	"comments_available" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connected_by" uuid,
	"meta_user_id" text NOT NULL,
	"meta_user_name" text,
	"access_token_encrypted" text NOT NULL,
	"token_type" text DEFAULT 'long_lived_user' NOT NULL,
	"granted_scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"token_expires_at" timestamp with time zone,
	"data_access_expires_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"last_error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"picture_url" text,
	"followers_count" integer,
	"category" text,
	"page_access_token_encrypted" text,
	"linked_page_id" text,
	"tasks" text[] DEFAULT '{}'::text[] NOT NULL,
	"can_moderate" boolean DEFAULT false NOT NULL,
	"webhook_subscribed" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"backfill_completed_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"rate_limit_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"username" text,
	"picture_url" text,
	"is_page" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"negative_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"is_blocked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"post_id" uuid,
	"ad_id" uuid,
	"author_id" uuid,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"external_parent_id" text,
	"parent_comment_id" uuid,
	"thread_root_id" uuid,
	"depth" smallint DEFAULT 0 NOT NULL,
	"source_type" "source_type" DEFAULT 'organic_post' NOT NULL,
	"message" text,
	"message_normalized" text,
	"attachment" jsonb,
	"message_tags" jsonb,
	"permalink_url" text,
	"published_at" timestamp with time zone NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"is_from_page" boolean DEFAULT false NOT NULL,
	"is_own_reply" boolean DEFAULT false NOT NULL,
	"can_hide" boolean DEFAULT false NOT NULL,
	"can_like" boolean DEFAULT false NOT NULL,
	"can_remove" boolean DEFAULT false NOT NULL,
	"can_comment" boolean DEFAULT true NOT NULL,
	"can_reply_privately" boolean DEFAULT false NOT NULL,
	"user_likes" boolean DEFAULT false NOT NULL,
	"status" "comment_status" DEFAULT 'new' NOT NULL,
	"assigned_to" uuid,
	"assigned_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"sla_due_at" timestamp with time zone,
	"sla_breached" boolean DEFAULT false NOT NULL,
	"urgency_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"edit_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted_on_platform" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"ingested_via" text DEFAULT 'webhook' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_analysis_id" uuid,
	"ai_sentiment" "sentiment_label",
	"ai_intent" "intent_label",
	"ai_urgency" "urgency_label",
	"ai_confidence" numeric(4, 3),
	"ai_is_toxic" boolean DEFAULT false NOT NULL,
	"ai_is_spam" boolean DEFAULT false NOT NULL,
	"ai_is_question" boolean DEFAULT false NOT NULL,
	"primary_topic_id" uuid
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"source_type" "source_type" DEFAULT 'organic_post' NOT NULL,
	"message" text,
	"permalink_url" text,
	"media_url" text,
	"thumbnail_url" text,
	"media_type" text,
	"media_product_type" text,
	"published_at" timestamp with time zone,
	"is_dark_post" boolean DEFAULT false NOT NULL,
	"ad_id" uuid,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"likes_count" integer DEFAULT 0 NOT NULL,
	"shares_count" integer DEFAULT 0 NOT NULL,
	"comments_enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"next_cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_id" uuid,
	"action" "action_type" NOT NULL,
	"status" "action_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"external_result_id" text,
	"error_code" integer,
	"error_subcode" integer,
	"error_message" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"from_value" jsonb,
	"to_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_tags" (
	"comment_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_tags_comment_id_tag_id_pk" PRIMARY KEY("comment_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "reply_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"shortcut" text,
	"category" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"sentiment" "sentiment_label" NOT NULL,
	"sentiment_score" numeric(4, 3) NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"intent" "intent_label" NOT NULL,
	"urgency" "urgency_label" NOT NULL,
	"emotions" text[] DEFAULT '{}'::text[] NOT NULL,
	"language" text,
	"is_question" boolean DEFAULT false NOT NULL,
	"requires_response" boolean DEFAULT false NOT NULL,
	"is_toxic" boolean DEFAULT false NOT NULL,
	"toxicity_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"contains_pii" boolean DEFAULT false NOT NULL,
	"pii_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_spam" boolean DEFAULT false NOT NULL,
	"mentions_competitor" boolean DEFAULT false NOT NULL,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"suggested_reply" text,
	"reasoning" text,
	"model" text NOT NULL,
	"model_version" text,
	"prompt_version" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 6),
	"latency_ms" integer,
	"status" "ai_job_status" DEFAULT 'succeeded' NOT NULL,
	"error_message" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"human_sentiment" "sentiment_label",
	"human_intent" "intent_label",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"parent_topic_id" uuid,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"centroid" vector(1536),
	"is_managed" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"avg_sentiment" numeric(4, 3),
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_type" text NOT NULL,
	"model" text NOT NULL,
	"generation_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"items_processed" integer DEFAULT 1 NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_embeddings" (
	"comment_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_topics" (
	"comment_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"relevance" numeric(4, 3) DEFAULT '1.0' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"assigned_by" text DEFAULT 'ai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_topics_comment_id_topic_id_pk" PRIMARY KEY("comment_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" smallint DEFAULT 100 NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"date" date NOT NULL,
	"social_account_id" uuid,
	"platform" "platform",
	"source_type" "source_type",
	"comments_total" integer DEFAULT 0 NOT NULL,
	"comments_replied" integer DEFAULT 0 NOT NULL,
	"comments_hidden" integer DEFAULT 0 NOT NULL,
	"comments_deleted" integer DEFAULT 0 NOT NULL,
	"sentiment_very_negative" integer DEFAULT 0 NOT NULL,
	"sentiment_negative" integer DEFAULT 0 NOT NULL,
	"sentiment_neutral" integer DEFAULT 0 NOT NULL,
	"sentiment_positive" integer DEFAULT 0 NOT NULL,
	"sentiment_very_positive" integer DEFAULT 0 NOT NULL,
	"net_sentiment_score" numeric(5, 2),
	"avg_first_response_minutes" numeric(10, 2),
	"median_first_response_minutes" numeric(10, 2),
	"sla_breaches" integer DEFAULT 0 NOT NULL,
	"unique_authors" integer DEFAULT 0 NOT NULL,
	"ai_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_daily_org_date_account_platform_source_key" UNIQUE NULLS NOT DISTINCT("organization_id","date","social_account_id","platform","source_type")
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"social_account_id" uuid,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" numeric(5, 2) DEFAULT '0' NOT NULL,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"items_total" integer,
	"cursor" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"date" date NOT NULL,
	"comments_total" integer DEFAULT 0 NOT NULL,
	"avg_sentiment" numeric(4, 3),
	"share_of_voice" numeric(5, 2)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_type" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"process_status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	CONSTRAINT "webhook_events_payload_hash_received_at_key" UNIQUE("payload_hash","received_at")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_authors" ADD CONSTRAINT "comment_authors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_comment_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."comment_authors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_comment_id_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_thread_root_id_comments_id_fk" FOREIGN KEY ("thread_root_id") REFERENCES "public"."comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_actions" ADD CONSTRAINT "comment_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_actions" ADD CONSTRAINT "comment_actions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_actions" ADD CONSTRAINT "comment_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_events" ADD CONSTRAINT "comment_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_events" ADD CONSTRAINT "comment_events_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_events" ADD CONSTRAINT "comment_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_tags" ADD CONSTRAINT "comment_tags_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_tags" ADD CONSTRAINT "comment_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_tags" ADD CONSTRAINT "comment_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_templates" ADD CONSTRAINT "reply_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_templates" ADD CONSTRAINT "reply_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_topics" ADD CONSTRAINT "ai_topics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_topics" ADD CONSTRAINT "ai_topics_parent_topic_id_ai_topics_id_fk" FOREIGN KEY ("parent_topic_id") REFERENCES "public"."ai_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_embeddings" ADD CONSTRAINT "comment_embeddings_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_embeddings" ADD CONSTRAINT "comment_embeddings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_topics" ADD CONSTRAINT "comment_topics_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_topics" ADD CONSTRAINT "comment_topics_topic_id_ai_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."ai_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_topics" ADD CONSTRAINT "comment_topics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_metrics_daily" ADD CONSTRAINT "topic_metrics_daily_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_metrics_daily" ADD CONSTRAINT "topic_metrics_daily_topic_id_ai_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."ai_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_org_email_idx" ON "invitations" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_key" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_accounts_org_external_key" ON "ad_accounts" USING btree ("organization_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_org_external_key" ON "ads" USING btree ("organization_id","external_ad_id");--> statement-breakpoint
CREATE INDEX "ads_story_idx" ON "ads" USING btree ("effective_object_story_id");--> statement-breakpoint
CREATE INDEX "ads_ig_media_idx" ON "ads" USING btree ("effective_instagram_media_id");--> statement-breakpoint
CREATE INDEX "ads_account_idx" ON "ads" USING btree ("ad_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_connections_org_user_key" ON "meta_connections" USING btree ("organization_id","meta_user_id");--> statement-breakpoint
CREATE INDEX "meta_connections_verify_idx" ON "meta_connections" USING btree ("status","last_verified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_org_platform_external_key" ON "social_accounts" USING btree ("organization_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "social_accounts_external_idx" ON "social_accounts" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "social_accounts_connection_idx" ON "social_accounts" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_authors_org_platform_external_key" ON "comment_authors" USING btree ("organization_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "comment_authors_org_volume_idx" ON "comment_authors" USING btree ("organization_id","comments_count" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "comments_org_platform_external_key" ON "comments" USING btree ("organization_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "comments_inbox_idx" ON "comments" USING btree ("organization_id","status","published_at" DESC NULLS LAST) WHERE deleted_on_platform = false;--> statement-breakpoint
CREATE INDEX "comments_account_idx" ON "comments" USING btree ("organization_id","social_account_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comments_post_idx" ON "comments" USING btree ("post_id","published_at");--> statement-breakpoint
CREATE INDEX "comments_assigned_idx" ON "comments" USING btree ("organization_id","assigned_to","status");--> statement-breakpoint
CREATE INDEX "comments_urgency_idx" ON "comments" USING btree ("organization_id","urgency_score" DESC NULLS LAST,"published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comments_thread_idx" ON "comments" USING btree ("thread_root_id","depth","published_at");--> statement-breakpoint
CREATE INDEX "comments_search_idx" ON "comments" USING gin ("message_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "comments_sla_idx" ON "comments" USING btree ("organization_id","sla_due_at") WHERE status IN ('new','in_progress');--> statement-breakpoint
CREATE INDEX "comments_ai_sentiment_idx" ON "comments" USING btree ("organization_id","ai_sentiment","published_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE deleted_on_platform = false;--> statement-breakpoint
CREATE INDEX "comments_ai_intent_idx" ON "comments" USING btree ("organization_id","ai_intent","published_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE deleted_on_platform = false;--> statement-breakpoint
CREATE INDEX "comments_topic_idx" ON "comments" USING btree ("organization_id","primary_topic_id","published_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE deleted_on_platform = false;--> statement-breakpoint
CREATE INDEX "comments_toxic_idx" ON "comments" USING btree ("organization_id","published_at" DESC NULLS LAST) WHERE ai_is_toxic = true AND deleted_on_platform = false;--> statement-breakpoint
CREATE INDEX "comments_ad_idx" ON "comments" USING btree ("organization_id","ad_id","published_at" DESC NULLS LAST) WHERE ad_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "posts_org_platform_external_key" ON "posts" USING btree ("organization_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "posts_account_published_idx" ON "posts" USING btree ("organization_id","social_account_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_reconcile_idx" ON "posts" USING btree ("organization_id","last_synced_at");--> statement-breakpoint
CREATE INDEX "posts_ad_idx" ON "posts" USING btree ("ad_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_actions_org_idempotency_key" ON "comment_actions" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "comment_actions_comment_idx" ON "comment_actions" USING btree ("comment_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comment_actions_pending_idx" ON "comment_actions" USING btree ("status","created_at") WHERE status IN ('pending','processing');--> statement-breakpoint
CREATE INDEX "comment_events_comment_idx" ON "comment_events" USING btree ("comment_id","created_at");--> statement-breakpoint
CREATE INDEX "comment_tags_tag_idx" ON "comment_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "reply_templates_org_idx" ON "reply_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reply_templates_org_shortcut_key" ON "reply_templates" USING btree ("organization_id","shortcut") WHERE shortcut IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tags_org_name_key" ON "tags" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_analyses_comment_prompt_key" ON "ai_analyses" USING btree ("comment_id","prompt_version");--> statement-breakpoint
CREATE INDEX "ai_analyses_org_sentiment_idx" ON "ai_analyses" USING btree ("organization_id","sentiment","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_analyses_urgency_idx" ON "ai_analyses" USING btree ("organization_id","urgency") WHERE urgency IN ('high','critical');--> statement-breakpoint
CREATE INDEX "ai_analyses_reviewed_idx" ON "ai_analyses" USING btree ("organization_id","reviewed_at" DESC NULLS LAST) WHERE reviewed_at IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_topics_org_name_key" ON "ai_topics" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "ai_topics_org_active_idx" ON "ai_topics" USING btree ("organization_id","is_active") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "ai_usage_org_date_idx" ON "ai_usage_log" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comment_embeddings_hnsw_idx" ON "comment_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "comment_embeddings_org_idx" ON "comment_embeddings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "comment_topics_topic_idx" ON "comment_topics" USING btree ("organization_id","topic_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_org_idx" ON "audit_logs" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "automation_rules_active_idx" ON "automation_rules" USING btree ("organization_id","priority") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "metrics_daily_org_date_idx" ON "metrics_daily" USING btree ("organization_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "saved_views_org_user_idx" ON "saved_views" USING btree ("organization_id","user_id","sort_order");--> statement-breakpoint
CREATE INDEX "sync_jobs_account_idx" ON "sync_jobs" USING btree ("organization_id","social_account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sync_jobs_status_idx" ON "sync_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_metrics_daily_org_topic_date_key" ON "topic_metrics_daily" USING btree ("organization_id","topic_id","date");--> statement-breakpoint
CREATE INDEX "topic_metrics_daily_org_date_idx" ON "topic_metrics_daily" USING btree ("organization_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_events_pending_idx" ON "webhook_events" USING btree ("process_status","received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_hash_idx" ON "webhook_events" USING btree ("payload_hash");