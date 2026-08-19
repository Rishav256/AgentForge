import type { Request, Response } from 'express';
import { adminGraphQL } from './_lib/hasura';
import { actionError } from './_lib/actionError';
import { runWorkflowLoop } from './_lib/runWorkflow';

const GET_WORKFLOW_AND_MEMBERSHIP = `
  query GetWorkflowAndMembership($workflow_id: uuid!, $user_id: uuid!) {
    workflows_by_pk(id: $workflow_id) {
      id
      org_id
      organization {
        quota_limit
        quota_used
        org_members(where: { user_id: { _eq: $user_id } }) { role }
      }
    }
  }
`;

const CREATE_RUN = `
  mutation CreateRun($workflow_id: uuid!, $triggered_by: uuid!) {
    insert_workflow_runs_one(object: {
      workflow_id: $workflow_id, status: "running", triggered_by: $triggered_by,
      trigger_type: "manual", started_at: "now()"
    }) { id }
  }
`;

export default async function handler(req: Request, res: Response) {
  try {
    if (req.method !== 'POST')
      return actionError(res, 405, 'Method not allowed');

    const { input, session_variables } = req.body;
    const userId = session_variables?.['x-hasura-user-id'];
    const workflowId = input?.workflow_id;

    if (!userId) return actionError(res, 401, 'Missing session user');
    if (!workflowId) return actionError(res, 400, 'workflow_id is required');

    const data = await adminGraphQL<any>(GET_WORKFLOW_AND_MEMBERSHIP, {
      workflow_id: workflowId,
      user_id: userId,
    });
    const workflow = data.workflows_by_pk;
    if (!workflow) return actionError(res, 404, 'Workflow not found');

    const membership = workflow.organization.org_members[0];
    if (!membership)
      return actionError(res, 403, 'Not a member of this organization');
    if (membership.role === 'viewer')
      return actionError(res, 403, 'Viewers cannot trigger workflow runs');

    const { quota_limit, quota_used } = workflow.organization;
    if (quota_used >= quota_limit)
      return actionError(res, 429, 'Organization quota exhausted');

    const { insert_workflow_runs_one: run } = await adminGraphQL<any>(
      CREATE_RUN,
      {
        workflow_id: workflowId,
        triggered_by: userId,
      },
    );

    const result = await runWorkflowLoop({
      workflowId,
      workflowRunId: run.id,
      orgId: workflow.org_id,
      fromStepOrder: 0,
    });

    res.status(200).json({ run_id: run.id, status: result.status });
  } catch (err: any) {
    console.error('triggerWorkflowRun error:', err);
    return actionError(res, 500, 'Internal error triggering workflow run');
  }
}
