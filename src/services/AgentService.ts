/**
 * Barrel file — re-exports all agent sub-services for backward compatibility.
 */
import { AgentCore } from './agent/_contentAgentCore.ts';

export class AgentService {
  static runWorkflow = AgentCore.runWorkflow;
  static healthCheck = AgentCore.healthCheck;
}