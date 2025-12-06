import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';
import type { ChatMessage, Intent } from '@/lib/types';

export interface GetMessagesResponse {
  messages: ChatMessage[];
  total: number;
}

/**
 * GET /api/conversations/messages - Get all messages for a conversation
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    if (!conversationId) {
      throw new ValidationError('Conversation ID is required');
    }

    logger.apiRequest('GET', '/api/conversations/messages', { conversationId, limit, offset });

    const supabase = createAdminClient();

    // Get total count
    const { count } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId);

    // Get messages ordered by creation time
    const { data: messagesData, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Error fetching messages', error);
      throw new Error('Failed to fetch messages');
    }

    const messages: ChatMessage[] = (messagesData || []).map(msg => ({
      id: msg.id,
      sessionId: msg.session_id,
      conversationId: msg.conversation_id,
      role: msg.role,
      content: msg.content,
      intent: msg.intent ? (msg.intent as unknown as Intent) : undefined,
      createdAt: msg.created_at,
    }));

    const response: GetMessagesResponse = {
      messages,
      total: count || 0,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/conversations/messages', 200, duration);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Get messages API error', error);
    logger.apiResponse('GET', '/api/conversations/messages', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

