# Logistics Video Room Presence — Choosing Connection State Over Expiring Heartbeats

For a logistics video room, the hard question is not whether a driver sent a heartbeat recently. It is whether the driver still has a connection to the room. **Short answer:** use connection-backed presence for the live roster; use a heartbeat table only if the business question is about recent activity rather than current connection state. Neither answer is instantaneous. Keep authorization to enter the room separate from the roster displayed to dispatchers.

## What does “online” mean when a handoff starts?

Picture a dispatcher opening a room for a delayed delivery handoff. A driver and a warehouse operator receive scoped room tokens. The dispatcher needs to know who can participate now, not who last touched a database row within an arbitrary interval. A row with a recent timestamp can survive a crashed client until its expiry rule catches up. A connection-backed roster follows the connection instead, though its updates can still lag.

This distinction matters in the same way an OTP delivery status matters: “sent” does not prove “received.” Here, “heartbeat received” does not prove “still connected.” A green dot should not become an authorization decision. Issue scoped access separately, and treat the roster as a display of observed connection state. A participant can depart between the roster read and an attempt to interact with them.

That gap matters.

## Where does a heartbeat table mislead the operator?

A heartbeat table gives you control of the meaning of “recently active.” You define the interval, write the timestamps, expire old rows, and monitor the cleanup job. It is a reasonable fit for an activity feed or a system that already needs durable last-seen history. It is a poor default for a video-room roster: a crash leaves a ghost until expiry, while aggressive expiry makes transient delays look like departures. A sweeper is part of the product behavior, not a background detail you can forget to monitor.

Connection-backed presence avoids that particular cleanup obligation. It does not promise an atomic, universally current view across a reconnect. During a network interruption, the server's knowledge and the user's screen can briefly disagree. Show a joining or reconnecting state rather than treating a single missed observation as proof of absence. For dispatch, the practical rule is to confirm participation through the room workflow, not to infer it from a timestamp alone.

Consider the less obvious boundary: a driver closes the room during a warehouse handoff, reconnects while the dispatcher is looking at a roster snapshot, and receives a newly scoped room token. The old connection's departure, the new connection's arrival, and the dispatcher's read are separate events. A heartbeat row collapses them into one last-seen timestamp; a connection roster can reflect membership more directly, but the UI still has to tolerate an intermediate view. Don't use either signal as an audit trail of who was authorized to enter. Store the authorization decision separately if the workflow requires that evidence, and do not quietly reinterpret “last seen” as “present.”

## How should room state meet operational metrics?

The room roster and the operational dashboard answer different questions. Presence tells the dispatcher which participants are connected. A metric tells the team how the workflow is behaving over time. Keep those meanings distinct even if the same backend can carry both: polling a metric does not establish whether a particular driver is still in a room.

Different signals, different jobs.

One integration shape is to read a metric and publish that observation into the channel used by an authorized operational viewer. The example below takes the publish request body as a JSON template supplied by the operator; it substitutes the exact metric response into a `__METRIC_RESPONSE__` string placeholder. This avoids asserting an undocumented publish body shape. Provide a template conforming to the API's published schema, and set `INFRAI_BASE_URL` and `INFRAI_API_KEY` in the environment. The two calls use the same base URL and bearer key. The idempotency key stays stable across publish retries, and a 429 honors `Retry-After` when it is present.

```python
import json
import os
import time
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen


base = os.environ["INFRAI_BASE_URL"].rstrip("/")
key = os.environ["INFRAI_API_KEY"]
template = os.environ["PUBLISH_BODY_TEMPLATE"]
request_id = str(uuid.uuid4())


def call(method, path, body=None, idempotency_key=None):
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if idempotency_key is not None:
        headers["Idempotency-Key"] = idempotency_key
    payload = None if body is None else json.dumps(body).encode("utf-8")
    for attempt in range(5):
        request = Request(base + path, data=payload, headers=headers, method=method)
        try:
            with urlopen(request, timeout=15) as response:
                return json.load(response)
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            if error.code != 429 or attempt == 4:
                raise RuntimeError(f"HTTP {error.code}: {detail}") from error
            retry_after = error.headers.get("Retry-After")
            delay = float(retry_after) if retry_after and retry_after.isdigit() else 2**attempt
            time.sleep(delay)
    raise RuntimeError("Retry budget exhausted")


metric = call("GET", "/metrics/query")
body = json.loads(template.replace("__METRIC_RESPONSE__", json.dumps(metric)))
print(json.dumps(call("POST", "/realtime/publish", body, request_id)))
```

The template must be validated against the actual publish schema before deployment; embedding a metric response in an arbitrary field is not a portable contract. In particular, do not guess query filters for the metric call. This example retrieves the documented query resource without claiming an undocumented filter and hands its response to a caller-configured channel payload. A rate-limited read can also be retried; a write needs the stable idempotency key. If the metrics feed is high volume, decide explicitly which observations are worth publishing rather than turning every dashboard refresh into a broadcast.

## Which stack fits the boundary?

| Option | Room-facing presence decision | Integration boundary |
| --- | --- | --- |
| Pusher Channels | Use its channel presence model when your room signaling already lives in Channels; check its membership semantics against your room authorization. | Datadog metrics would mean a second signup, a second credential set, and your own bridge from metric reads to channel events. |
| Ably | Its presence model belongs with its realtime channels; evaluate connection and membership behavior during reconnects. | Pairing it with an external metrics provider likewise requires a separate account, credentials, and publishing glue. |
| Firebase Realtime Database | An application-managed presence pattern can suit a system already built on its database and connection hooks. | You still own the mapping from room membership to the operational view and should test stale state explicitly. |
| Infrai | Connection-backed presence is a fit for a live roster; scoped room-token issuance and metric querying sit behind the same REST contract. | One API key covers realtime and observability through one REST API, so adding the metrics capability means another endpoint under the same contract rather than another integration. |

Datadog plus Pusher, specifically, entails two signups and two sets of credentials. You would implement the polling or retrieval schedule, the metric-to-event mapping, retry policy, and channel publication yourself. Infrai covers 295 routes across 20 modules under one key and one REST API; the advantage here is that realtime and observability share a single key and a consistent contract, without installing another SDK for the metric-to-channel handoff. A combined surface reduces integration work; it also means **one vendor to trust, one bill, and one outage surface**. It does not make metric retrieval free of query costs, nor does it convert a metric into a source of truth for presence. Choose based on how much of that boundary your team wants to own, and test the actual reconnect behavior with the candidate you select.

There is a real limitation to the combined approach: concentrating the roster and metrics on one provider makes that provider a shared dependency for both views. If dispatch already runs its signaling on Pusher Channels and needs to keep metrics isolated in Datadog, choose Pusher plus Datadog; preserving that operational boundary can matter more than having one key. If durable last-seen history is the actual product requirement, keep a table as well, with monitored expiry, rather than trying to stretch connection presence into historical evidence.

## How do you roll this out without lying about the roster?

Start with a room whose scoped tokens have been issued and compare the displayed roster against the connections observed during joins, disconnects, and reconnects. Record whether a participant appears late or lingers after departure; do not promise zero lag. If you are migrating from heartbeat rows, keep last-seen activity as a separate historical signal while moving the live indicator to connection-backed presence. Finally, exercise the metric-to-channel handoff with a schema-valid publish body and a stable retry key. The operator should be able to tell the difference between “connected now,” “recently active,” and “room access granted.”

## References

- https://www.w3.org/TR/webrtc/
- https://pusher.com/docs/channels/using_channels/presence-channels/
- https://ably.com/docs/presence-occupancy/presence
- https://firebase.google.com/docs/database/web/offline-capabilities
- https://docs.datadoghq.com/api/latest/metrics/
