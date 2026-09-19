import assert from "node:assert/strict";
import { routeEvent, shipmentEvent } from "./shipment_chat.js";

const exception = shipmentEvent.parse({ shipmentId: "SHP-1", kind: "exception", note: "Damaged pallet" });
assert.equal(routeEvent(exception), "shipment.exception");
const delivered = shipmentEvent.parse({ shipmentId: "SHP-1", kind: "delivered", note: "Signed at dock", proofOfDelivery: "pod.pdf" });
assert.equal(routeEvent(delivered), "shipment.update");
console.log("shipment event routing passed");
