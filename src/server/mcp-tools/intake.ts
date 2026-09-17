

import { intakeOperations } from "../intake-api";

import { type AuthorizationActor } from "../authorization";

import { json, type ToolRegistrar } from './registry';

export function registerIntakeTools(registerTool: ToolRegistrar, actor: AuthorizationActor) {
  for(const op of intakeOperations)registerTool(op.name,{description:op.description,inputSchema:op.inputSchema},async input=>json(op.execute(input,actor)));
}
