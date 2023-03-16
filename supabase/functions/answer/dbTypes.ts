export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[]

export interface Database {
  public: {
    Tables: {
      question_answer_sections: {
        Row: {
          question_id: number
          section_id: number
          similarity: number | null
        }
        Insert: {
          question_id?: number
          section_id?: number
          similarity?: number | null
        }
        Update: {
          question_id?: number
          section_id?: number
          similarity?: number | null
        }
      }
      questions: {
        Row: {
          answer: string | null
          created_at: string | null
          embedding: unknown | null
          id: number
          prompt: string | null
          prompt_length: number | null
          question: string | null
          updated_at: string | null
        }
        Insert: {
          answer?: string | null
          created_at?: string | null
          embedding?: unknown | null
          id?: number
          prompt?: string | null
          prompt_length?: number | null
          question?: string | null
          updated_at?: string | null
        }
        Update: {
          answer?: string | null
          created_at?: string | null
          embedding?: unknown | null
          id?: number
          prompt?: string | null
          prompt_length?: number | null
          question?: string | null
          updated_at?: string | null
        }
      }
      sections: {
        Row: {
          content: string | null
          created_at: string | null
          embedding: unknown | null
          heading: string | null
          id: number
          page_summary: string | null
          page_title: string | null
          page_url: string | null
          updated_at: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          embedding?: unknown | null
          heading?: string | null
          id?: number
          page_summary?: string | null
          page_title?: string | null
          page_url?: string | null
          updated_at?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          embedding?: unknown | null
          heading?: string | null
          id?: number
          page_summary?: string | null
          page_title?: string | null
          page_url?: string | null
          updated_at?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ivfflathandler: {
        Args: {
          "": unknown
        }
        Returns: unknown
      }
      match_documents: {
        Args: {
          query_embedding: unknown
          similarity_threshold: number
          match_count: number
        }
        Returns: {
          id: number
          content: string
          similarity: number
        }[]
      }
      match_sections: {
        Args: {
          query_embedding: unknown
          similarity_threshold: number
          match_count: number
        }
        Returns: {
          id: number
          heading: string
          content: string
          page_url: string
          page_title: string
          page_summary: string
          similarity: number
        }[]
      }
      vector_avg: {
        Args: {
          "": number[]
        }
        Returns: unknown
      }
      vector_dims: {
        Args: {
          "": unknown
        }
        Returns: number
      }
      vector_norm: {
        Args: {
          "": unknown
        }
        Returns: number
      }
      vector_out: {
        Args: {
          "": unknown
        }
        Returns: unknown
      }
      vector_send: {
        Args: {
          "": unknown
        }
        Returns: string
      }
      vector_typmod_in: {
        Args: {
          "": unknown[]
        }
        Returns: number
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
