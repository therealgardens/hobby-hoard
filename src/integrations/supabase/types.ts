export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      binder_slots: {
        Row: {
          binder_id: string
          card_id: string | null
          id: string
          is_wanted: boolean
          position: number
          user_id: string
        }
        Insert: {
          binder_id: string
          card_id?: string | null
          id?: string
          is_wanted?: boolean
          position: number
          user_id: string
        }
        Update: {
          binder_id?: string
          card_id?: string | null
          id?: string
          is_wanted?: boolean
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "binder_slots_binder_id_fkey"
            columns: ["binder_id"]
            isOneToOne: false
            referencedRelation: "binders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "binder_slots_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      binders: {
        Row: {
          cols: number
          created_at: string
          game: string
          id: string
          name: string
          pages: number
          rows: number
          user_id: string
        }
        Insert: {
          cols?: number
          created_at?: string
          game: string
          id?: string
          name: string
          pages?: number
          rows?: number
          user_id: string
        }
        Update: {
          cols?: number
          created_at?: string
          game?: string
          id?: string
          name?: string
          pages?: number
          rows?: number
          user_id?: string
        }
        Relationships: []
      }
      cards: {
        Row: {
          code: string | null
          created_at: string
          data: Json | null
          external_id: string
          game: string
          id: string
          image_large: string | null
          image_small: string | null
          name: string
          number: string | null
          pokedex_number: number | null
          rarity: string | null
          set_id: string | null
          set_name: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          data?: Json | null
          external_id: string
          game: string
          id?: string
          image_large?: string | null
          image_small?: string | null
          name: string
          number?: string | null
          pokedex_number?: number | null
          rarity?: string | null
          set_id?: string | null
          set_name?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          data?: Json | null
          external_id?: string
          game?: string
          id?: string
          image_large?: string | null
          image_small?: string | null
          name?: string
          number?: string | null
          pokedex_number?: number | null
          rarity?: string | null
          set_id?: string | null
          set_name?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          body: string | null
          card_id: string | null
          created_at: string
          game: string | null
          id: string
          kind: string
          offer_card_id: string | null
          read_at: string | null
          recipient_id: string
          sender_id: string
          trade_status: string | null
        }
        Insert: {
          body?: string | null
          card_id?: string | null
          created_at?: string
          game?: string | null
          id?: string
          kind?: string
          offer_card_id?: string | null
          read_at?: string | null
          recipient_id: string
          sender_id: string
          trade_status?: string | null
        }
        Update: {
          body?: string | null
          card_id?: string | null
          created_at?: string
          game?: string | null
          id?: string
          kind?: string
          offer_card_id?: string | null
          read_at?: string | null
          recipient_id?: string
          sender_id?: string
          trade_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_card_fk"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_offer_card_fk"
            columns: ["offer_card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_entries: {
        Row: {
          card_id: string
          created_at: string
          game: string
          id: string
          language: string
          notes: string | null
          quantity: number
          rarity: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          card_id: string
          created_at?: string
          game: string
          id?: string
          language?: string
          notes?: string | null
          quantity?: number
          rarity?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          card_id?: string
          created_at?: string
          game?: string
          id?: string
          language?: string
          notes?: string | null
          quantity?: number
          rarity?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_entries_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      deck_cards: {
        Row: {
          code: string
          copies: number
          deck_id: string
          id: string
          user_id: string
        }
        Insert: {
          code: string
          copies?: number
          deck_id: string
          id?: string
          user_id: string
        }
        Update: {
          code?: string
          copies?: number
          deck_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deck_cards_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id"]
          },
        ]
      }
      decks: {
        Row: {
          created_at: string
          game: string
          id: string
          name: string
          raw_list: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          game?: string
          id?: string
          name: string
          raw_list?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          game?: string
          id?: string
          name?: string
          raw_list?: string | null
          user_id?: string
        }
        Relationships: []
      }
      friend_shares: {
        Row: {
          friend_id: string
          game: string
          id: string
          owner_id: string
          share_binders: boolean
          share_collection: boolean
          share_decks: boolean
          share_wanted: boolean
          updated_at: string
        }
        Insert: {
          friend_id: string
          game: string
          id?: string
          owner_id: string
          share_binders?: boolean
          share_collection?: boolean
          share_decks?: boolean
          share_wanted?: boolean
          updated_at?: string
        }
        Update: {
          friend_id?: string
          game?: string
          id?: string
          owner_id?: string
          share_binders?: boolean
          share_collection?: boolean
          share_decks?: boolean
          share_wanted?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      friendships: {
        Row: {
          addressee_id: string
          blocked_by: string | null
          created_at: string
          id: string
          requester_id: string
          status: string
          updated_at: string
        }
        Insert: {
          addressee_id: string
          blocked_by?: string | null
          created_at?: string
          id?: string
          requester_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          addressee_id?: string
          blocked_by?: string | null
          created_at?: string
          id?: string
          requester_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pokedex_entries: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          pokedex_number: number
          registered: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          pokedex_number: number
          registered?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          pokedex_number?: number
          registered?: boolean
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          username?: string | null
        }
        Relationships: []
      }
      wanted_cards: {
        Row: {
          binder_id: string | null
          card_id: string
          created_at: string
          game: string
          id: string
          language: string | null
          quantity: number
          rarity: string | null
          user_id: string
        }
        Insert: {
          binder_id?: string | null
          card_id: string
          created_at?: string
          game: string
          id?: string
          language?: string | null
          quantity?: number
          rarity?: string | null
          user_id: string
        }
        Update: {
          binder_id?: string | null
          card_id?: string
          created_at?: string
          game?: string
          id?: string
          language?: string | null
          quantity?: number
          rarity?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wanted_cards_binder_id_fkey"
            columns: ["binder_id"]
            isOneToOne: false
            referencedRelation: "binders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wanted_cards_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      are_friends: { Args: { _a: string; _b: string }; Returns: boolean }
      cancel_trade: { Args: { _message_id: string }; Returns: undefined }
      is_blocked: { Args: { _a: string; _b: string }; Returns: boolean }
      mark_message_read: { Args: { _message_id: string }; Returns: undefined }
      mark_thread_read: { Args: { _friend_id: string }; Returns: undefined }
      respond_to_trade: {
        Args: { _message_id: string; _status: string }
        Returns: undefined
      }
      shares_with: {
        Args: {
          _friend: string
          _game: string
          _module: string
          _owner: string
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
