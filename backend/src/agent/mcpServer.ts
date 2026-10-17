import { timingSafeEqual } from 'node:crypto';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';
import type { Request, RequestHandler, Response } from 'express';
import {
  ToolError,
  alternativeInput,
  disruptionsInput,
  inspectInput,
  planJourneyInput,
  recordInput,
  resolveStationInput,
  type StepFreeToolbox,
} from './toolbox.js';

/**
 * The StepFree MCP server: a fixed catalogue of six tools, each backed by human-written, parameterised Cypher
 * (see RoutingGraph) or the existing TfL lift feed. There is deliberately no tool that accepts query text.
 */
export function createStepFreeMcpServer(toolbox: StepFreeToolbox): McpServer {
  const server = new McpServer({ name: 'stepfree', version: '1.0.0' });

  const respond = async (work: () => Promise<unknown>) => {
    try {
      const result = await work();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result as Record<string, unknown> };
    } catch (error) {
      if (error instanceof ToolError) {
        const body = { error: error.code, message: error.message };
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(body) }], structuredContent: body };
      }
      console.error(error);
      const body = { error: 'INTERNAL', message: 'The tool could not complete.' };
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(body) }], structuredContent: body };
    }
  };

  server.registerTool(
    'resolve_station',
    {
      description:
        'Check a station name against the stations StepFree supports (London Underground only) by looking it up in the FalkorDB graph. ' +
        'Returns found=false for anything that is not a supported station. Use it only when a name is ambiguous or you are unsure: plan_step_free_journey already resolves both stations itself.',
      inputSchema: resolveStationInput,
    },
    (input) => respond(() => toolbox.resolveStation(input)),
  );

  server.registerTool(
    'plan_step_free_journey',
    {
      description:
        'Ask FalkorDB for the fastest fully step-free route between two stations (weighted shortest path over the step-free graph). ' +
        'It resolves both station names against the supported network itself (unsupported names return UNKNOWN_STATION) and returns a routeId, canonical station names, the duration, stations, lines, changes, and the accessibility connections the route depends on (requiredConnectionIds, allConnectionIds). ' +
        'Pass unavailableConnectionIds only for lifts you already know are out of service.',
      inputSchema: planJourneyInput,
    },
    (input) => respond(() => toolbox.planStepFreeJourney(input)),
  );

  server.registerTool(
    'inspect_route_dependencies',
    {
      description:
        'List, step by step, the accessibility connections (lifts and step-free transfers) a route depends on. plan_step_free_journey and find_alternative_route already return the summary (requiredConnectionIds), so call this only when you need the per-connection detail.',
      inputSchema: inspectInput,
    },
    (input) => respond(() => toolbox.inspectRouteDependencies(input)),
  );

  server.registerTool(
    'get_accessibility_disruptions',
    {
      description:
        'Get the lifts currently out of service in the supported network. In demo mode this is the controlled demo outage; in live mode it is the real TfL lift disruption feed. ' +
        'Pass relevantConnectionIds (the route requiredConnectionIds) so each disruption is flagged relevant or not.',
      inputSchema: disruptionsInput,
    },
    (input) => respond(() => toolbox.getAccessibilityDisruptions(input)),
  );

  server.registerTool(
    'find_alternative_route',
    {
      description:
        'Ask FalkorDB for the next valid step-free route once the listed unavailable connections are excluded from the graph. ' +
        'Use this only after a disruption affects a connection the current route requires.',
      inputSchema: alternativeInput,
    },
    (input) => respond(() => toolbox.findAlternativeRoute(input)),
  );

  server.registerTool(
    'record_journey_decision',
    {
      description:
        'Record the action you took for this journey in FalkorDB. Reference the routeId you selected for ROUTE_SELECTED, ROUTE_RETAINED and REROUTED. ' +
        'reasonCode is a short factual UPPER_SNAKE_CASE code such as NO_DISRUPTION or REQUIRED_LIFT_UNAVAILABLE. Call this once, when you have decided.',
      inputSchema: recordInput,
    },
    (input) => respond(() => toolbox.recordJourneyDecision(input)),
  );

  return server;
}

/** Express handler for POST /mcp (Streamable HTTP, stateless). Requires the backend's own bearer token. */
export function mcpHandler(toolbox: StepFreeToolbox, token: string): RequestHandler {
  const expected = Buffer.from(`Bearer ${token}`);
  return async (req: Request, res: Response) => {
    const given = Buffer.from(req.headers.authorization ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.status(401).json({ error: 'The StepFree MCP endpoint is internal to the StepFree backend.' });
      return;
    }
    const server = createStepFreeMcpServer(toolbox);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
}
