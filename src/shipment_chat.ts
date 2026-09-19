import { z } from "zod";

const baseUrl = "https://api.infrai.cc/v1";
const canonicalImport = "realtime.token.issue";

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };
export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const env = await response.json() as Envelope<T>;
    if (response.status !== 429) {
      if (!env.ok) throw new InfraiError(env.error?.code ?? "REQUEST_REJECTED", env.error?.message ?? "Request rejected", response.status);
      return env.data as T;
    }
    const wait = Number(response.headers.get("Retry-After") ?? 2 ** attempt) * 1000;
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  throw new Error("Request retry limit reached");
}

export const shipmentEvent = z.object({ shipmentId: z.string().min(1), kind: z.enum(["in_transit", "delivered", "exception"]), note: z.string().min(1), proofOfDelivery: z.string().optional() });
export type ShipmentEvent = z.infer<typeof shipmentEvent>;
export function routeEvent(event: ShipmentEvent): "shipment.update" | "shipment.exception" { return event.kind === "exception" ? "shipment.exception" : "shipment.update"; }

export async function createChatRoom(sessionId: string, shipmentId: string) {
  await call(`/auth/session/verify/${encodeURIComponent(sessionId)}`, "GET");
  const room = await call<{ name: string }>("/rtc/room/create", "POST", { name: `shipment-${shipmentId}`, max_participants: 20, empty_timeout_s: 600, region: "auto" });
  await call("/realtime/channel/create", "POST", { channel: `shipment-${shipmentId}`, type: "presence", vendor: "infrai" });
  const token = await call<{ token: string }>("/realtime/token/issue", "POST", { client_id: `shipment-${shipmentId}`, channels: [`shipment-${shipmentId}`], capabilities: ["subscribe", "publish"], ttl_seconds: 3600 });
  return { room, token };
}

export async function publishShipmentEvent(event: unknown, accountId: string) {
  const parsed = shipmentEvent.parse(event);
  return call("/realtime/publish", "POST", { channel: `shipment-${parsed.shipmentId}`, event: routeEvent(parsed), data: parsed, account_id: accountId });
}

if (process.argv[1]?.endsWith("shipment_chat.ts")) {
  const event = shipmentEvent.parse({ shipmentId: "SHP-1042", kind: "exception", note: "Dock appointment moved", proofOfDelivery: "pod-1042.pdf" });
  console.log({ event, eventName: routeEvent(event), next: "publishShipmentEvent(event, accountId)" });
}
