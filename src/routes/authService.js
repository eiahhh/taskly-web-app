class AuthService {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
  }

  // Register new user
  async signUp(email, password, fullname) {
    try {
      const { data, error } = await this.supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            full_name: fullname
          }
        }
      });

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Sign up error:', error);
      return { success: false, error: error.message };
    }
  }

  // Sign in user
  async signIn(email, password) {
    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Sign in error:', error);
      return { success: false, error: error.message };
    }
  }

  // Sign out user
  async signOut() {
    try {
      const { error } = await this.supabase.auth.signOut();
      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Sign out error:', error);
      return { success: false, error: error.message };
    }
  }

  // Reset password
  async resetPassword(email) {
    try {
      const { data, error } = await this.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/update-password'
      });

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Reset password error:', error);
      return { success: false, error: error.message };
    }
  }

  // Get current user
  async getCurrentUser() {
    try {
      const { data: { user }, error } = await this.supabase.auth.getUser();
      if (error) throw error;
      return { success: true, user };
    } catch (error) {
      console.error('Get user error:', error);
      return { success: false, error: error.message };
    }
  }

  // Check if user is logged in
  async isAuthenticated() {
    const { data: { session } } = await this.supabase.auth.getSession();
    return !!session;
  }

  // Update profile 
  async updateProfile({ full_name, nickname, mobile_number, bio }) {
    try {
      const { data: { user }, error: userError } = await this.supabase.auth.getUser();
      if (userError) throw userError;

      const { data, error } = await this.supabase
        .from('profiles')
        .upsert({
          id: user.id,
          full_name,
          nickname,
          mobile_number,
          bio,
          updated_at: new Date()
        });

      if (error) throw error;

      return { success: true, data };
    } catch (error) {
      console.error('Update profile error:', error);
      return { success: false, error: error.message };
    }
  }

  // Change user password
  async changePassword(newPassword) {
    try {
      const { error } = await this.supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Change password error:', error);
      return { success: false, error: error.message };
    }
  }
} // <- Class ends here

// Export for use in HTML files
if (typeof window !== 'undefined') {
  window.AuthService = AuthService;
}