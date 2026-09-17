
import * as planningApi from "./api";

import { useResourceQuery } from "../../use-resource-query";

import { InvalidResponseError } from "../../api";
import { keys } from "../../query-keys";
import { useSession } from "../../app-context";

import type { IntakeCatalog } from "../../../shared/intake";
import "../../components/requirement-intake.css";

export function useIntake(projectId:string) {
  const {session}=useSession();
  return useResourceQuery<IntakeCatalog>([...keys.intake,projectId,session.accountId],signal => planningApi.projectsRequirementIntake<IntakeCatalog>(projectId, { signal }),!!projectId,value=>{if(!value||!Array.isArray(value.features))throw new InvalidResponseError(200,false,'需求特性响应不完整');});
}
