import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';

export interface Conversation {
  id: string;
  sessionId: string;
  title: string;
  summary: string | null;
  isActive: boolean;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListConversationsResponse {
  conversations: Conversation[];
  total: number;
}

export interface CreateConversationResponse {
  conversation: Conversation;
}

/**
 * GET /api/conversations - List all conversations for a session
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    if (!sessionId) {
      throw new ValidationError('Session ID is required');
    }

    logger.apiRequest('GET', '/api/conversations', { sessionId, limit, offset });

    const supabase = createAdminClient();

    // Get total count
    const { count } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId);

    // Get conversations
    const { data: conversationsData, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('session_id', sessionId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Error fetching conversations', error);
      throw new Error('Failed to fetch conversations');
    }

    const conversations: Conversation[] = (conversationsData || []).map(conv => ({
      id: conv.id,
      sessionId: conv.session_id,
      title: conv.title,
      summary: conv.summary,
      isActive: conv.is_active,
      messageCount: conv.message_count,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
    }));

    const response: ListConversationsResponse = {
      conversations,
      total: count || 0,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/conversations', 200, duration);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('List conversations API error', error);
    logger.apiResponse('GET', '/api/conversations', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

/**
 * POST /api/conversations - Create a new conversation
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { sessionId, title } = body;

    if (!sessionId) {
      throw new ValidationError('Session ID is required');
    }

    logger.apiRequest('POST', '/api/conversations', { sessionId, title });

    const supabase = createAdminClient();

    // Verify session exists
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .single();

    if (sessionError || !sessionData) {
      throw new ValidationError('Invalid session ID');
    }

    // Create new conversation
    const { data: conversationData, error } = await supabase
      .from('conversations')
      .insert({
        session_id: sessionId,
        title: title || 'New Chat',
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      logger.error('Error creating conversation', error);
      throw new Error('Failed to create conversation');
    }

    const conversation: Conversation = {
      id: conversationData.id,
      sessionId: conversationData.session_id,
      title: conversationData.title,
      summary: conversationData.summary,
      isActive: conversationData.is_active,
      messageCount: conversationData.message_count,
      createdAt: conversationData.created_at,
      updatedAt: conversationData.updated_at,
    };

    const response: CreateConversationResponse = { conversation };

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/conversations', 201, duration);
    logger.info('Created new conversation', { conversationId: conversation.id });

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Create conversation API error', error);
    logger.apiResponse('POST', '/api/conversations', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

/**
 * DELETE /api/conversations - Delete a conversation
 */
export async function DELETE(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) {
      throw new ValidationError('Conversation ID is required');
    }

    logger.apiRequest('DELETE', '/api/conversations', { conversationId });

    const supabase = createAdminClient();

    // Delete conversation (this will cascade delete all messages due to foreign key)
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId);

    if (error) {
      logger.error('Error deleting conversation', error);
      throw new Error('Failed to delete conversation');
    }

    const duration = Date.now() - startTime;
    logger.apiResponse('DELETE', '/api/conversations', 200, duration);
    logger.info('Deleted conversation', { conversationId });

    return NextResponse.json({ success: true });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Delete conversation API error', error);
    logger.apiResponse('DELETE', '/api/conversations', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

/**
 * PATCH /api/conversations - Update a conversation (rename, etc.)
 */
export async function PATCH(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { conversationId, title, isActive } = body;

    if (!conversationId) {
      throw new ValidationError('Conversation ID is required');
    }

    logger.apiRequest('PATCH', '/api/conversations', { conversationId, title, isActive });

    const supabase = createAdminClient();

    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (isActive !== undefined) updates.is_active = isActive;

    if (Object.keys(updates).length === 0) {
      throw new ValidationError('No updates provided');
    }

    const { data: conversationData, error } = await supabase
      .from('conversations')
      .update(updates)
      .eq('id', conversationId)
      .select()
      .single();

    if (error) {
      logger.error('Error updating conversation', error);
      throw new Error('Failed to update conversation');
    }

    const conversation: Conversation = {
      id: conversationData.id,
      sessionId: conversationData.session_id,
      title: conversationData.title,
      summary: conversationData.summary,
      isActive: conversationData.is_active,
      messageCount: conversationData.message_count,
      createdAt: conversationData.created_at,
      updatedAt: conversationData.updated_at,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('PATCH', '/api/conversations', 200, duration);

    return NextResponse.json({ conversation });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Update conversation API error', error);
    logger.apiResponse('PATCH', '/api/conversations', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

