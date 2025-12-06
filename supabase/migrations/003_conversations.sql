-- Conversations table to group chat messages
-- This allows users to have multiple chat conversations that persist

-- Create conversations table
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat',
  summary TEXT,
  is_active BOOLEAN DEFAULT true,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add conversation_id to chat_messages table
ALTER TABLE public.chat_messages 
ADD COLUMN conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE;

-- Create index for faster lookups
CREATE INDEX idx_conversations_session_id ON public.conversations(session_id);
CREATE INDEX idx_conversations_updated_at ON public.conversations(updated_at DESC);
CREATE INDEX idx_chat_messages_conversation_id ON public.chat_messages(conversation_id);

-- Trigger to update conversation message_count and updated_at
CREATE OR REPLACE FUNCTION update_conversation_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.conversations
    SET 
      message_count = message_count + 1,
      updated_at = NOW()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.conversations
    SET 
      message_count = GREATEST(0, message_count - 1),
      updated_at = NOW()
    WHERE id = OLD.conversation_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conversation_stats_trigger
AFTER INSERT OR DELETE ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_stats();

-- Trigger to auto-update conversation title from first user message
CREATE OR REPLACE FUNCTION update_conversation_title()
RETURNS TRIGGER AS $$
DECLARE
  conv_title TEXT;
  msg_count INTEGER;
BEGIN
  -- Only update if this is a user message
  IF NEW.role = 'user' THEN
    -- Check if this is one of the first messages
    SELECT message_count INTO msg_count
    FROM public.conversations
    WHERE id = NEW.conversation_id;
    
    IF msg_count <= 1 THEN
      -- Truncate the message content to create a title (max 50 chars)
      conv_title := LEFT(NEW.content, 50);
      IF LENGTH(NEW.content) > 50 THEN
        conv_title := conv_title || '...';
      END IF;
      
      UPDATE public.conversations
      SET title = conv_title
      WHERE id = NEW.conversation_id AND title = 'New Chat';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conversation_title_trigger
AFTER INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_title();

-- Trigger to update updated_at on conversations
CREATE TRIGGER update_conversations_updated_at
BEFORE UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable RLS on conversations
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for conversations
CREATE POLICY "Users can view own conversations" ON public.conversations
  FOR SELECT USING (
    session_id IN (SELECT id FROM public.sessions WHERE wallet_address = 
      (SELECT wallet_address FROM public.sessions WHERE id = session_id LIMIT 1))
  );

CREATE POLICY "Users can create conversations" ON public.conversations
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own conversations" ON public.conversations
  FOR UPDATE USING (
    session_id IN (SELECT id FROM public.sessions WHERE wallet_address = 
      (SELECT wallet_address FROM public.sessions WHERE id = session_id LIMIT 1))
  );

CREATE POLICY "Users can delete own conversations" ON public.conversations
  FOR DELETE USING (
    session_id IN (SELECT id FROM public.sessions WHERE wallet_address = 
      (SELECT wallet_address FROM public.sessions WHERE id = session_id LIMIT 1))
  );

-- Service role policies (for API operations)
CREATE POLICY "Service role can manage all conversations" ON public.conversations
  FOR ALL USING (true);

