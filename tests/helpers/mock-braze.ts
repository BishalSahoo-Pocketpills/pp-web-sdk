/**
 * Create a full mock Braze SDK object matching the core SDK interface.
 */
export function createMockBraze() {
  const userAttributes: Record<string, any> = {};
  const customAttributes: Record<string, any> = {};

  const mockUser = {
    setEmail: vi.fn((v: string) => { userAttributes.email = v; }),
    setFirstName: vi.fn((v: string) => { userAttributes.first_name = v; }),
    setLastName: vi.fn((v: string) => { userAttributes.last_name = v; }),
    setPhoneNumber: vi.fn((v: string) => { userAttributes.phone = v; }),
    setGender: vi.fn((v: string) => { userAttributes.gender = v; }),
    setDateOfBirth: vi.fn((v: string) => { userAttributes.dob = v; }),
    setCountry: vi.fn((v: string) => { userAttributes.country = v; }),
    setHomeCity: vi.fn((v: string) => { userAttributes.city = v; }),
    setLanguage: vi.fn((v: string) => { userAttributes.language = v; }),
    setCustomUserAttribute: vi.fn((key: string, value: any) => { customAttributes[key] = value; }),
    _userAttributes: userAttributes,
    _customAttributes: customAttributes
  };

  return {
    initialize: vi.fn(),
    openSession: vi.fn(),
    changeUser: vi.fn(),
    logCustomEvent: vi.fn(),
    logPurchase: vi.fn(),
    requestImmediateDataFlush: vi.fn(),
    getUser: vi.fn(() => mockUser),
    _mockUser: mockUser
  };
}
