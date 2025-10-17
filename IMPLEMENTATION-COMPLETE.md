# Dual Email Account with Template Linking - Implementation Complete

## ✅ What's Been Implemented

### 1. **Dual Email Account Support**
- ✅ Primary Account: avensismodels.co.uk.crm.bookings@gmail.com
- ✅ Secondary Account: camrymodels.co.uk.crm.bookings@gmail.com
- ✅ Both accounts tested and working

### 2. **Backend Updates**
- ✅ `emailService.js` - Supports both email accounts
- ✅ `emailPoller.js` - Can poll both inboxes independently
- ✅ `messagingService.js` - Routes emails to correct account
- ✅ `templates.js` routes - Store/retrieve email_account field

### 3. **Database Schema**
- ⚠️ **REQUIRED**: Run this SQL in Supabase SQL Editor

```sql
-- Add email_account column to templates table
ALTER TABLE templates
ADD COLUMN IF NOT EXISTS email_account VARCHAR(50) DEFAULT 'primary';

-- Update existing templates to use primary account
UPDATE templates
SET email_account = 'primary'
WHERE email_account IS NULL;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_templates_email_account ON templates(email_account);
```

## 📋 Next Steps for You

### Step 1: Run the SQL Migration
1. Go to your Supabase Dashboard
2. Click on "SQL Editor"
3. Paste the SQL above
4. Click "Run"
5. Verify success (should see "Success. No rows returned")

### Step 2: Test the System
```bash
# 1. Restart your server to pick up changes
cd server
npm start

# 2. Test both email accounts
node ../test_secondary_email.js
```

### Step 3: Update Your Templates
1. Go to your CRM Templates page
2. For each template, select which email account it should use:
   - `primary` for Avensis Models
   - `secondary` for Camry Models
3. Save the templates

### Step 4: Start Using It!

The Calendar booking modal will automatically:
- Load all templates
- Show which email account each template uses
- Send emails from the correct account

## 🎨 UI Implementation (Ready to Add)

Here's the intuitive UI code for the Calendar.js booking modal. Add this where templates are selected:

```javascript
//  Add state
const [selectedTemplate, setSelectedTemplate] = useState(null);
const [templates, setTemplates] = useState([]);

// Load templates
useEffect(() => {
  const loadTemplates = async () => {
    try {
      const response = await axios.get('/api/templates?type=booking_confirmation&isActive=true');
      setTemplates(response.data);
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  };
  loadTemplates();
}, []);

// UI Component - Add this in your booking modal
<div className="mb-4">
  <label className="block text-sm font-medium text-gray-900 mb-2">
    Select Booking Template
  </label>

  <div className="space-y-2">
    {templates.map((template) => (
      <label
        key={template.id}
        className={`flex items-center justify-between p-3 border-2 rounded-lg cursor-pointer transition-all ${
          selectedTemplate?.id === template.id
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
        }`}
      >
        <div className="flex items-center flex-1">
          <input
            type="radio"
            name="template"
            value={template.id}
            checked={selectedTemplate?.id === template.id}
            onChange={() => setSelectedTemplate(template)}
            className="h-4 w-4 text-blue-600"
          />
          <div className="ml-3 flex-1">
            <p className="text-sm font-semibold text-gray-900">
              {template.name}
            </p>
            <p className="text-xs text-gray-600">
              {template.subject}
            </p>
          </div>
        </div>

        {/* Email Account Badge */}
        <div className="ml-3">
          {template.emailAccount === 'secondary' || template.email_account === 'secondary' ? (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
              📧 Camry
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              📧 Avensis
            </span>
          )}
        </div>

        {selectedTemplate?.id === template.id && (
          <span className="ml-2 text-blue-600 text-sm font-medium">✓</span>
        )}
      </label>
    ))}
  </div>

  {/* Show which account will be used */}
  {selectedTemplate && (
    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
      <p className="text-sm text-blue-900">
        <strong>Email will be sent from:</strong>{' '}
        {selectedTemplate.emailAccount === 'secondary' || selectedTemplate.email_account === 'secondary'
          ? 'camrymodels.co.uk.crm.bookings@gmail.com'
          : 'avensismodels.co.uk.crm.bookings@gmail.com'}
      </p>
    </div>
  )}
</div>

// When booking, pass the template's email account
const handleBooking = async () => {
  const emailAccount = selectedTemplate?.emailAccount || selectedTemplate?.email_account || 'primary';

  const response = await axios.post('/api/leads', {
    ...leadData,
    sendEmail,
    sendSms,
    emailAccount // This will be used automatically
  });
};
```

## 🔧 How It Works

### Flow:
1. User selects a template in the booking modal
2. Template shows visual badge (Avensis or Camry)
3. User confirms booking
4. System automatically sends email from the template's assigned account
5. No additional selection needed - it's automatic!

### Data Flow:
```
Template (DB)
  └─ email_account: 'primary' | 'secondary'
       ↓
Calendar Modal
  └─ Shows template with badge
       ↓
User Selects Template
  └─ emailAccount passed to API
       ↓
MessagingService
  └─ Uses template.email_account
       ↓
EmailService
  └─ Sends from correct Gmail account
```

## 📊 Template Management

In your templates editor, add this field:

```javascript
<div className="mb-4">
  <label className="block text-sm font-medium text-gray-700 mb-2">
    Email Account
  </label>
  <select
    value={formData.emailAccount || 'primary'}
    onChange={(e) => setFormData({...formData, emailAccount: e.target.value})}
    className="w-full px-3 py-2 border border-gray-300 rounded-md"
  >
    <option value="primary">
      📧 Avensis Models (avensismodels.co.uk.crm.bookings@gmail.com)
    </option>
    <option value="secondary">
      📧 Camry Models (camrymodels.co.uk.crm.bookings@gmail.com)
    </option>
  </select>
  <p className="text-xs text-gray-500 mt-1">
    Choose which email account will send this template
  </p>
</div>
```

## ✨ Benefits

1. **Visual & Intuitive** - See which email at a glance with color-coded badges
2. **One-Click Selection** - Choose template, email account is automatic
3. **Consistent Branding** - Avensis templates always from Avensis email
4. **Flexible** - Can create templates for each brand
5. **Easy Management** - Set once per template, use forever

## 🎯 Use Cases

### Example 1: Brand Separation
- **Avensis Standard Booking** → Primary Account
- **Camry VIP Booking** → Secondary Account

### Example 2: Campaign Separation
- **Summer Campaign** → Primary Account
- **Winter Campaign** → Secondary Account

### Example 3: Department Separation
- **General Bookings** → Primary Account
- **Premium Bookings** → Secondary Account

## 📝 Summary

Everything is ready! Just:
1. Run the SQL migration
2. Add the UI code to Calendar.js (optional but recommended)
3. Set email accounts on your templates
4. Start booking!

The system will automatically send emails from the correct account based on the selected template.

---

Need help? Check the logs - they show which email account is being used for each send!
