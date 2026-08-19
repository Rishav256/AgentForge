import { adminGraphQL } from './hasura';
import { executeStep } from './stepExecutors';

interface WorkflowStep {
  id: string;
  step_order: number;
  type:
    | 'llm_call'
    | 'http_request'
    | 'db_write'
    | 'notify'
    | 'conditional_branch'
    | 'approval_gate';
  config: Record<string, any>;
}

const GET_STEPS_FROM = `
  query GetStepsFrom($workflow_id: uuid!, $from_order: Int!) {
    workflow_steps(
      where: { workflow_id: { _eq: $workflow_id }, step_order: { _gte: $from_order } }
      order_by: { step_order: asc }
    ) {
      id
      step_order
      type
      config
    }
  }
`;

const CREATE_STEP_RUN = `
  mutation CreateStepRun($workflow_run_id: uuid!, $workflow_step_id: uuid!, $input: jsonb) {
    insert_step_runs_one(object: {
      workflow_run_id: $workflow_run_id,
      workflow_step_id: $workflow_step_id,
      status: "running",
      input: $input,
      started_at: "now()"
    }) { id }
  }
`;

const UPDATE_STEP_RUN = `
  mutation UpdateStepRun($id: uuid!, $status: step_run_status!, $output: jsonb, $error: String, $attempt_count: Int) {
    update_step_runs_by_pk(pk_columns: { id: $id }, _set: {
      status: $status, output: $output, error: $error, attempt_count: $attempt_count, completed_at: "now()"
    }) { id }
  }
`;

const PAUSE_FOR_APPROVAL = `
  mutation PauseForApproval($step_run_id: uuid!, $workflow_run_id: uuid!) {
    update_step_runs_by_pk(pk_columns: { id: $step_run_id }, _set: { status: "paused", started_at: "now()" }) { id }
    update_workflow_runs_by_pk(pk_columns: { id: $workflow_run_id }, _set: { status: "paused" }) { id }
  }
`;

const FAIL_RUN = `
  mutation FailRun($workflow_run_id: uuid!) {
    update_workflow_runs_by_pk(pk_columns: { id: $workflow_run_id }, _set: { status: "failed", completed_at: "now()" }) { id }
  }
`;

const COMPLETE_RUN = `
  mutation CompleteRun($workflow_run_id: uuid!, $org_id: uuid!) {
    update_workflow_runs_by_pk(pk_columns: { id: $workflow_run_id }, _set: { status: "completed", completed_at: "now()" }) { id }
    update_organizations_by_pk(pk_columns: { id: $org_id }, _inc: { quota_used: 1 }) { id }
  }
`;

export async function runWorkflowLoop(params: {
  workflowId: string;
  workflowRunId: string;
  orgId: string;
  fromStepOrder: number;
  previousOutput?: any;
}) {
  const { workflowId, workflowRunId, orgId, fromStepOrder } = params;
  let previousOutput = params.previousOutput ?? null;

  const { workflow_steps: steps } = await adminGraphQL<{
    workflow_steps: WorkflowStep[];
  }>(GET_STEPS_FROM, { workflow_id: workflowId, from_order: fromStepOrder });

  for (const step of steps) {
    if (step.type === 'approval_gate') {
      const { insert_step_runs_one } = await adminGraphQL<any>(
        CREATE_STEP_RUN,
        {
          workflow_run_id: workflowRunId,
          workflow_step_id: step.id,
          input: previousOutput,
        },
      );
      await adminGraphQL(PAUSE_FOR_APPROVAL, {
        step_run_id: insert_step_runs_one.id,
        workflow_run_id: workflowRunId,
      });
      return { status: 'paused', pausedAtStep: step.id };
    }

    const { insert_step_runs_one: stepRun } = await adminGraphQL<any>(
      CREATE_STEP_RUN,
      {
        workflow_run_id: workflowRunId,
        workflow_step_id: step.id,
        input: previousOutput,
      },
    );

    let attempt = 0;
    let lastError: string | null = null;
    let succeeded = false;

    while (attempt < 2 && !succeeded) {
      attempt++;
      try {
        const result = await executeStep(step, { previousOutput });
        await adminGraphQL(UPDATE_STEP_RUN, {
          id: stepRun.id,
          status: 'succeeded',
          output: result.output,
          error: null,
          attempt_count: attempt,
        });
        previousOutput = result.output;
        succeeded = true;
      } catch (err: any) {
        lastError = err.message ?? String(err);
      }
    }

    if (!succeeded) {
      await adminGraphQL(UPDATE_STEP_RUN, {
        id: stepRun.id,
        status: 'failed',
        output: null,
        error: lastError,
        attempt_count: attempt,
      });
      await adminGraphQL(FAIL_RUN, { workflow_run_id: workflowRunId });
      return { status: 'failed', failedAtStep: step.id, error: lastError };
    }
  }

  await adminGraphQL(COMPLETE_RUN, {
    workflow_run_id: workflowRunId,
    org_id: orgId,
  });
  return { status: 'completed' };
}
