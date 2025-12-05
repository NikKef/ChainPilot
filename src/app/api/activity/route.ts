import { NextRequest, NextResponse } from 'next/server';
import type { ActivityResponse, ActionLog } from '@/lib/types';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';

// In-memory activity store for demo (use database in production)
const activityStore: Map<string, ActionLog[]> = new Map();

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status');
    const intentType = searchParams.get('intentType');

    if (!sessionId) {
      throw new ValidationError('Session ID is required');
    }

    logger.apiRequest('GET', '/api/activity', { sessionId, limit, offset });

    // Get logs for session
    let logs = activityStore.get(sessionId) || [];

    // Filter by status if provided
    if (status) {
      logs = logs.filter(log => log.status === status);
    }

    // Filter by intent type if provided
    if (intentType) {
      logs = logs.filter(log => log.intentType === intentType);
    }

    // Sort by date (newest first)
    logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply pagination
    const total = logs.length;
    const paginatedLogs = logs.slice(offset, offset + limit);

    const response: ActivityResponse = {
      logs: paginatedLogs,
      total,
      hasMore: offset + limit < total,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/activity', 200, duration);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Activity API error', error);
    logger.apiResponse('GET', '/api/activity', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

// Helper to add activity log (called from other routes)
export function addActivityLog(sessionId: string, log: ActionLog): void {
  const logs = activityStore.get(sessionId) || [];
  logs.push(log);
  activityStore.set(sessionId, logs);
}

