
export interface MasterRecord {
  id: string;
  name: string;
  code?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MasterInput {
  name: string;
  code?: string;
  isActive: boolean;
}

export interface MasterUpdateInput {
  name?: string;
  code?: string;
  isActive?: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface MasterApi {
  list(signal?: AbortSignal): Promise<MasterRecord[]>;

  create(input: MasterInput): Promise<MasterRecord>;

  update(
    id: string,
    input: MasterUpdateInput
  ): Promise<MasterRecord>;

  deactivate(id: string): Promise<MasterRecord>;
}
