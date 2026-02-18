import api from './api';

export interface Role {
    id: number;
    name: string;
    description: string;
    permissions: Record<string, boolean>;
    can_manage_users: boolean;
    can_view_reports: boolean;
    can_edit_products: boolean;
    can_perform_sales: boolean;
    can_perform_returns: boolean;
}

export interface RoleUpdate {
    description?: string;
    permissions?: Record<string, boolean>;
    can_manage_users?: boolean;
    can_view_reports?: boolean;
    can_edit_products?: boolean;
    can_perform_sales?: boolean;
    can_perform_returns?: boolean;
}

export const roleService = {
    getRoles: async (): Promise<Role[]> => {
        const response = await api.get('/roles/');
        return response.data;
    },

    getRole: async (id: number): Promise<Role> => {
        const response = await api.get(`/roles/${id}`);
        return response.data;
    },

    updateRole: async (id: number, data: RoleUpdate): Promise<Role> => {
        const response = await api.put(`/roles/${id}`, data);
        return response.data;
    }
};
