import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { AppConfig, IngestionMode } from "../types/index.js";

const DEFAULTS: Omit<AppConfig, "atomic" | "discord"> = {
  ingestion: {
    reaction_emoji: "atomic",
    fallback_emoji: "🧠",
    default_settle_window: 300,
    default_mode: "reaction-only",
    include_bot_messages: false,
    include_embeds: true,
    max_thread_depth: 100,
    forum_tag_mapping: true,
  },
  tags: {
    auto_channel: true,
    auto_guild: false,
    custom_prefix: "discord",
  },
};

export function loadConfig(configPath: string): AppConfig {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parse(raw) as Record<string, unknown>;

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid config file: ${configPath}`);
  }

  const atomic = parsed.atomic as Record<string, string> | undefined;
  if (!atomic?.server_url || !atomic?.api_token) {
    throw new Error(
      "Config must include atomic.server_url and atomic.api_token",
    );
  }

  const discord = parsed.discord as Record<string, string> | undefined;
  if (!discord?.bot_token) {
    throw new Error("Config must include discord.bot_token");
  }

  const ingestion = (parsed.ingestion ?? {}) as Record<string, unknown>;
  const tags = (parsed.tags ?? {}) as Record<string, unknown>;

  return {
    atomic: {
      server_url: atomic.server_url.replace(/\/+$/, ""),
      api_token: atomic.api_token,
    },
    discord: {
      bot_token: discord.bot_token,
    },
    ingestion: {
      reaction_emoji:
        (ingestion.reaction_emoji as string) ??
        DEFAULTS.ingestion.reaction_emoji,
      fallback_emoji:
        (ingestion.fallback_emoji as string) ??
        DEFAULTS.ingestion.fallback_emoji,
      default_settle_window:
        (ingestion.default_settle_window as number) ??
        DEFAULTS.ingestion.default_settle_window,
      default_mode:
        (ingestion.default_mode as IngestionMode) ??
        DEFAULTS.ingestion.default_mode,
      include_bot_messages:
        (ingestion.include_bot_messages as boolean) ??
        DEFAULTS.ingestion.include_bot_messages,
      include_embeds:
        (ingestion.include_embeds as boolean) ??
        DEFAULTS.ingestion.include_embeds,
      max_thread_depth:
        (ingestion.max_thread_depth as number) ??
        DEFAULTS.ingestion.max_thread_depth,
      forum_tag_mapping:
        (ingestion.forum_tag_mapping as boolean) ??
        DEFAULTS.ingestion.forum_tag_mapping,
    },
    tags: {
      auto_channel:
        (tags.auto_channel as boolean) ?? DEFAULTS.tags.auto_channel,
      auto_guild: (tags.auto_guild as boolean) ?? DEFAULTS.tags.auto_guild,
      custom_prefix:
        (tags.custom_prefix as string) ?? DEFAULTS.tags.custom_prefix,
    },
  };
}
