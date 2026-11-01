ALTER TABLE "admin_mcp_servers" ADD COLUMN "oauth_token_url" text;--> statement-breakpoint
ALTER TABLE "admin_mcp_servers" ADD COLUMN "oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "admin_mcp_servers" ADD COLUMN "oauth_scope" text;--> statement-breakpoint
ALTER TABLE "admin_mcp_servers" ADD COLUMN "oauth_audience" text;--> statement-breakpoint
ALTER TABLE "admin_mcp_servers" ADD COLUMN "oauth_client_auth_method" text;--> statement-breakpoint
ALTER TABLE "admin_mcp_servers" ADD COLUMN "oauth_client_secret_ciphertext" text;