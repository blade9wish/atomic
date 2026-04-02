import type {
  AtomPayload,
  AtomResponse,
  BulkCreateResponse,
  SearchResult,
  TagWithCount,
} from "../types/index.js";

export class AtomicApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Atomic API error: ${status} - ${body}`);
    this.name = "AtomicApiError";
  }
}

export class AtomicClient {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new AtomicApiError(res.status, text);
    }

    return res.json() as Promise<T>;
  }

  async createAtom(payload: AtomPayload): Promise<AtomResponse> {
    return this.request<AtomResponse>("POST", "/api/atoms", {
      content: payload.content,
      source_url: payload.source_url ?? null,
      published_at: payload.published_at ?? null,
      tag_ids: payload.tag_ids ?? [],
    });
  }

  async updateAtom(
    id: string,
    payload: AtomPayload,
  ): Promise<AtomResponse> {
    return this.request<AtomResponse>("PUT", `/api/atoms/${id}`, {
      content: payload.content,
      source_url: payload.source_url ?? null,
      published_at: payload.published_at ?? null,
      tag_ids: payload.tag_ids ?? [],
    });
  }

  async getAtom(id: string): Promise<AtomResponse> {
    return this.request<AtomResponse>("GET", `/api/atoms/${id}`);
  }

  async deleteAtom(id: string): Promise<void> {
    await this.request<unknown>("DELETE", `/api/atoms/${id}`);
  }

  async createAtomsBulk(
    payloads: AtomPayload[],
  ): Promise<BulkCreateResponse> {
    return this.request<BulkCreateResponse>(
      "POST",
      "/api/atoms/bulk",
      payloads.map((p) => ({
        content: p.content,
        source_url: p.source_url ?? null,
        published_at: p.published_at ?? null,
        tag_ids: p.tag_ids ?? [],
      })),
    );
  }

  async searchAtoms(
    query: string,
    mode: "keyword" | "semantic" | "hybrid" = "semantic",
    limit = 10,
  ): Promise<SearchResult[]> {
    return this.request<SearchResult[]>("POST", "/api/search", {
      query,
      mode,
      limit,
    });
  }

  async getTags(): Promise<TagWithCount[]> {
    return this.request<TagWithCount[]>("GET", "/api/tags");
  }

  async ping(): Promise<boolean> {
    try {
      await this.request("GET", "/api/atoms?limit=1");
      return true;
    } catch {
      return false;
    }
  }
}
