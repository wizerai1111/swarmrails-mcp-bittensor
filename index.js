#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

const GATEWAY = "https://xosljjzcpsouwifbclsy.supabase.co/functions/v1/payment_gate";

const SUBNETS = {
  1:  { name: "Text Prompting",        price: 0.005, async: false },
  3:  { name: "Machine Translation",   price: 0.005, async: false },
  4:  { name: "Targon (Reasoning)",    price: 0.05,  async: false },
  5:  { name: "Image Generation",      price: 0.075, async: false },
  6:  { name: "Nous Research LLM",     price: 0.01,  async: false },
  8:  { name: "Time Series Predict",   price: 0.05,  async: false },
  11: { name: "Code Generation",       price: 0.01,  async: false },
  13: { name: "Data Universe",         price: 0.005, async: false },
  16: { name: "Voice TTS",             price: 0.025, async: false },
  18: { name: "Video Generation",      price: 2.00,  async: true  },
  21: { name: "Web Scraping",          price: 0.01,  async: false },
  24: { name: "Omega Multimodal",      price: 0.02,  async: false },
  29: { name: "3D Asset Generation",   price: 0.75,  async: true  },
};

const server = new Server(
  { name: "swarmrails-mcp-bittensor", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// LIST TOOLS
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_subnets",
      description: "List all available Bittensor subnets with pricing and capabilities",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "get_payment_info",
      description: "Get USDC wallet address and payment instructions for Swarmrails",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "call_subnet",
      description: "Call any Bittensor subnet via Swarmrails x402 gateway using a USDC tx hash",
      inputSchema: {
        type: "object",
        required: ["netuid", "prompt", "tx_hash"],
        properties: {
          netuid: {
            type: "number",
            description: "Subnet ID (1, 3, 4, 5, 6, 8, 11, 13, 16, 18, 21, 24, 29)"
          },
          prompt: {
            type: "string",
            description: "Input prompt or instruction for the subnet"
          },
          tx_hash: {
            type: "string",
            description: "Fresh USDC transaction hash on Base blockchain (0x...)"
          },
          image_url: {
            type: "string",
            description: "Image URL — only required for netuid 29 (3D Asset Generation)"
          },
          agent_id: {
            type: "string",
            description: "Optional agent identifier for tracking"
          }
        }
      }
    },
    {
      name: "poll_job",
      description: "Poll status of async jobs (Video Generation netuid 18, 3D Assets netuid 29)",
      inputSchema: {
        type: "object",
        required: ["job_id"],
        properties: {
          job_id: {
            type: "string",
            description: "Job ID returned from async call_subnet"
          }
        }
      }
    }
  ]
}));

// HANDLE TOOL CALLS
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // LIST SUBNETS
  if (name === "list_subnets") {
    const list = Object.entries(SUBNETS).map(([id, s]) => ({
      netuid: Number(id),
      name: s.name,
      price_usdc: `$${s.price}`,
      type: s.async ? "Async (poll for result)" : "Sync (instant response)"
    }));
    return {
      content: [{
        type: "text",
        text: JSON.stringify(list, null, 2)
      }]
    };
  }

  // PAYMENT INFO
  if (name === "get_payment_info") {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          wallet_address: "0x14a129b3e3Bd154c974118299d75F14626A6157B",
          network: "Base",
          token: "USDC",
          usdc_contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          basescan_url: "https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          instructions: [
            "1. Send exact USDC amount for your subnet on Base network",
            "2. Copy your transaction hash from Basescan",
            "3. Use header: Authorization: x402 agent:0xYOUR_TX_HASH",
            "4. One hash = one API call (10 minute window)",
            "5. Never reuse a transaction hash"
          ],
          subnet_prices: Object.entries(SUBNETS).reduce((acc, [id, s]) => {
            acc[s.name] = `$${s.price} USDC`;
            return acc;
          }, {})
        }, null, 2)
      }]
    };
  }

  // CALL SUBNET
  if (name === "call_subnet") {
    const { netuid, prompt, tx_hash, image_url, agent_id } = args;

    if (!SUBNETS[netuid]) {
      return {
        content: [{ type: "text", text: `Error: Subnet ${netuid} not found. Available: ${Object.keys(SUBNETS).join(", ")}` }],
        isError: true
      };
    }

    const body = {
      prompt,
      netuid,
      ...(agent_id && { agent_id }),
      ...(image_url && { image_url })
    };

    try {
      const response = await axios.post(GATEWAY, body, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `x402 agent:${tx_hash}`
        },
        timeout: 30000
      });

      const subnet = SUBNETS[netuid];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            subnet: subnet.name,
            netuid,
            result: response.data
          }, null, 2)
        }]
      };
    } catch (error) {
      const errMsg = error.response?.data || error.message;
      return {
        content: [{ type: "text", text: `Error calling subnet ${netuid}: ${JSON.stringify(errMsg)}` }],
        isError: true
      };
    }
  }

  // POLL JOB
  if (name === "poll_job") {
    try {
      const response = await axios.get(`${GATEWAY}?job_id=${args.job_id}`);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(response.data, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error polling job: ${error.message}` }],
        isError: true
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true
  };
});

// START SERVER
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Swarmrails MCP Bittensor server running...");
