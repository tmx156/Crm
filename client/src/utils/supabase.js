import { createClient } from '@supabase/supabase-js';

// Centralized Supabase configuration for client
// Note: In production, these should be environment variables
// For now, using the same secure approach with fallback
const supabaseConfig = {
  url: process.env.REACT_APP_SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co',
  anonKey: process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc'
};

// Create Supabase client with centralized configuration
export const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);

// Export configuration for debugging (remove in production)
export const supabaseConfig_debug = {
  ...supabaseConfig,
  isUsingFallback: !process.env.REACT_APP_SUPABASE_URL
};

// Auth helper functions
export const signUp = async (email, password, userData) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: userData
    }
  });
  return { data, error };
};

export const signIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  return { data, error };
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  return { error };
};

export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  return { user, error };
};

export const getCurrentSession = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  return { session, error };
};

// Database helper functions
export const getLeads = async (userId = null) => {
  let query = supabase.from('leads').select('*');
  
  if (userId) {
    query = query.eq('booker_id', userId);
  }
  
  const { data, error } = await query;
  return { data, error };
};

export const createLead = async (leadData) => {
  const { data, error } = await supabase
    .from('leads')
    .insert(leadData)
    .select();
  return { data, error };
};

export const updateLead = async (id, updates) => {
  const { data, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', id)
    .select();
  return { data, error };
};

export const deleteLead = async (id) => {
  const { error } = await supabase
    .from('leads')
    .delete()
    .eq('id', id);
  return { error };
};

export const getSales = async (userId = null) => {
  let query = supabase
    .from('sales')
    .select(`
      *,
      leads (
        id,
        name,
        email,
        phone
      )
    `);
  
  if (userId) {
    query = query.eq('leads.booker_id', userId);
  }
  
  const { data, error } = await query;
  return { data, error };
};

export const createSale = async (saleData) => {
  const { data, error } = await supabase
    .from('sales')
    .insert(saleData)
    .select();
  return { data, error };
};

export const getUsers = async () => {
  const { data, error } = await supabase
    .from('users')
    .select('*');
  return { data, error };
};

export const getUserProfile = async (userId) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  return { data, error };
};

// Real-time subscriptions
export const subscribeToLeads = (callback) => {
  return supabase
    .channel('leads_changes')
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'leads' }, 
      callback
    )
    .subscribe();
};

export const subscribeToSales = (callback) => {
  return supabase
    .channel('sales_changes')
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'sales' }, 
      callback
    )
    .subscribe();
};

export default supabase; 