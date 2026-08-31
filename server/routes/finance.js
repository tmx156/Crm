const express = require('express');
const { auth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const dbManager = require('../database-connection-manager');

const router = express.Router();

// Generate unique agreement number
function generateAgreementNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `FIN-${year}${month}-${random}`;
}

// Calculate next payment date based on frequency
function calculateNextPaymentDate(currentDate, frequency, dueDay = 1) {
  const nextDate = new Date(currentDate);
  
  switch (frequency.toLowerCase()) {
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case 'bi-weekly':
      nextDate.setDate(nextDate.getDate() + 14);
      break;
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1);
      nextDate.setDate(dueDay);
      break;
    case 'quarterly':
      nextDate.setMonth(nextDate.getMonth() + 3);
      nextDate.setDate(dueDay);
      break;
    case 'bi-monthly':
      nextDate.setMonth(nextDate.getMonth() + 2);
      nextDate.setDate(dueDay);
      break;
    default:
      nextDate.setMonth(nextDate.getMonth() + 1);
      nextDate.setDate(dueDay);
  }
  
  return nextDate;
}

// @route   POST /api/finance/agreement
// @desc    Create new finance agreement
// @access  Private
router.post('/agreement', auth, async (req, res) => {
  try {
    const {
      leadId,
      saleId,
      totalAmount,
      paymentAmount,
      frequency,
      startDate,
      dueDay = 1,
      gracePeriodDays = 5,
      lateFeeAmount = 0,
      notes,
      emailReminders = true,
      smsReminders = true
    } = req.body;

    // Ensure paymentAmount is a valid number
    const numericPaymentAmount = parseFloat(paymentAmount);
    const numericTotalAmount = parseFloat(totalAmount);

    if (!leadId || !numericTotalAmount || !numericPaymentAmount || !frequency || !startDate) {
      return res.status(400).json({
        message: 'Lead ID, total amount, payment amount, frequency, and start date are required'
      });
    }

    if (isNaN(numericPaymentAmount) || numericPaymentAmount <= 0) {
      return res.status(400).json({
        message: 'Payment amount must be a valid positive number'
      });
    }

    // Check if finance agreement already exists for this sale
    if (saleId) {
      const existingAgreement = await dbManager.query('finance', {
        select: 'id',
        eq: { sale_id: saleId }
      });

      if (existingAgreement && existingAgreement.length > 0) {
        return res.status(400).json({
          message: 'Finance agreement already exists for this sale'
        });
      }
    }

    // Calculate payment details
    const startDateObj = new Date(startDate);
    const nextPaymentDate = calculateNextPaymentDate(startDateObj, frequency, dueDay);
    const remainingAmount = numericTotalAmount;

    const agreementData = {
      id: uuidv4(),
      lead_id: leadId,
      sale_id: saleId || null,
      total_amount: numericTotalAmount,
      deposit_amount: 0,
      monthly_payment: numericPaymentAmount,
      payment_frequency: frequency,
      term_months: Math.ceil(numericTotalAmount / numericPaymentAmount),
      interest_rate: 0,
      start_date: startDate,
      next_payment_date: nextPaymentDate.toISOString().split('T')[0],
      status: 'active',
      agreement_number: generateAgreementNumber(),
      total_paid: 0,
      remaining_balance: remainingAmount,
      notes: notes || ''
    };


    // Insert into Supabase
    const result = await dbManager.insert('finance', [agreementData]);

    // Get the created agreement with lead info
    const agreementWithLead = await dbManager.query('finance', {
      select: `
        *,
        leads!inner(name, email, phone)
      `,
      eq: { id: agreementData.id }
    });

    const agreement = agreementWithLead[0];
    if (agreement && agreement.leads) {
      agreement.lead_name = agreement.leads.name;
      agreement.lead_email = agreement.leads.email;
      agreement.lead_phone = agreement.leads.phone;
      delete agreement.leads;
    }

    res.status(201).json({
      message: 'Finance agreement created successfully',
      agreement
    });

  } catch (error) {
    console.error('Error creating finance agreement:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/finance/agreements
// @desc    Get all finance agreements
// @access  Private
router.get('/agreements', auth, async (req, res) => {
  try {
    const { status, leadId } = req.query;
    
    // Build filters for Supabase query
    const filters = {};
    
    if (status && status !== 'all') {
      filters.eq = { status };
    }
    
    if (leadId) {
      filters.eq = { ...filters.eq, lead_id: leadId };
    }

    // Get finance agreements from Supabase
    const agreements = await dbManager.query('finance', {
      select: `
        id, lead_id, sale_id, total_amount, deposit_amount, monthly_payment,
        term_months, interest_rate, start_date, status, remaining_balance,
        agreement_number, total_paid, created_at
      `,
      ...filters,
      order: { created_at: 'desc' }
    });

    // Get lead and user details for each agreement
    const agreementsWithDetails = await Promise.all(
      (agreements || []).map(async (agreement) => {
        const [leadResult, userResult] = await Promise.all([
          dbManager.query('leads', {
            select: 'name, email, phone',
            eq: { id: agreement.lead_id }
          }),
          agreement.sales_agent ? dbManager.query('users', {
            select: 'name',
            eq: { id: agreement.sales_agent }
          }) : Promise.resolve([])
        ]);

        return {
          ...agreement,
          lead_name: leadResult?.[0]?.name || 'Unknown',
          lead_email: leadResult?.[0]?.email || '',
          lead_phone: leadResult?.[0]?.phone || '',
          agent_name: userResult?.[0]?.name || 'Unknown'
        };
      })
    );

    res.json(agreementsWithDetails);

  } catch (error) {
    console.error('Error fetching finance agreements:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/finance/agreement/:id
// @desc    Get single finance agreement
// @access  Private
router.get('/agreement/:id', auth, async (req, res) => {
  try {
    const agreementResult = await dbManager.query('finance', {
      select: `
        *,
        leads!inner(name, email, phone)
      `,
      eq: { id: req.params.id }
    });

    if (!agreementResult || agreementResult.length === 0) {
      return res.status(404).json({ message: 'Finance agreement not found' });
    }

    const agreement = agreementResult[0];
    if (agreement.leads) {
      agreement.lead_name = agreement.leads.name;
      agreement.lead_email = agreement.leads.email;
      agreement.lead_phone = agreement.leads.phone;
      delete agreement.leads;
    }

    // Get payment history
    const payments = await dbManager.query('finance_payments', {
      select: '*',
      eq: { finance_id: agreement.id },
      order: { payment_date: 'desc' }
    });

    res.json({
      ...agreement,
      payments: payments || [],
      reminders: [] // Reminders not implemented yet
    });

  } catch (error) {
    console.error('Error fetching finance agreement:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/finance/agreement/:id
// @desc    Update finance agreement
// @access  Private
router.put('/agreement/:id', auth, async (req, res) => {
  try {
    const {
      paymentAmount,
      frequency,
      notes,
      status
    } = req.body;

    // Check if agreement exists
    const existingAgreement = await dbManager.query('finance', {
      select: '*',
      eq: { id: req.params.id }
    });

    if (!existingAgreement || existingAgreement.length === 0) {
      return res.status(404).json({ message: 'Finance agreement not found' });
    }

    // Build update data
    const updateData = {};
    if (paymentAmount !== undefined) updateData.monthly_payment = paymentAmount;
    if (frequency !== undefined) updateData.payment_frequency = frequency;
    if (notes !== undefined) updateData.notes = notes;
    if (status !== undefined) updateData.status = status;

    // Recalculate next payment date if frequency changed
    if (frequency !== undefined) {
      const lastPaymentDate = existingAgreement[0].next_payment_date || existingAgreement[0].start_date;
      updateData.next_payment_date = calculateNextPaymentDate(
        new Date(lastPaymentDate),
        frequency,
        1
      ).toISOString().split('T')[0];
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    updateData.updated_at = new Date().toISOString();

    // Update agreement
    const result = await dbManager.update('finance', updateData, { id: req.params.id });

    // Get updated agreement with lead info
    const updatedAgreementResult = await dbManager.query('finance', {
      select: `
        *,
        leads!inner(name, email, phone)
      `,
      eq: { id: req.params.id }
    });

    const updatedAgreement = updatedAgreementResult[0];
    if (updatedAgreement && updatedAgreement.leads) {
      updatedAgreement.lead_name = updatedAgreement.leads.name;
      updatedAgreement.lead_email = updatedAgreement.leads.email;
      updatedAgreement.lead_phone = updatedAgreement.leads.phone;
      delete updatedAgreement.leads;
    }

    res.json({
      message: 'Finance agreement updated successfully',
      agreement: updatedAgreement
    });

  } catch (error) {
    console.error('Error updating finance agreement:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/finance/payment
// @desc    Record a payment
// @access  Private
router.post('/payment', auth, async (req, res) => {
  try {
    const {
      financeId,
      leadId,
      amount,
      paymentMethod = 'Card',
      reference = '',
      notes = ''
    } = req.body;

    if (!financeId || !leadId || !amount) {
      return res.status(400).json({
        message: 'Finance ID, lead ID, and amount are required'
      });
    }

    // Get finance agreement
    const agreementResult = await dbManager.query('finance', {
      select: '*',
      eq: { id: financeId }
    });

    if (!agreementResult || agreementResult.length === 0) {
      return res.status(404).json({ message: 'Finance agreement not found' });
    }

    const agreement = agreementResult[0];

    // Get current payment count for this agreement
    const existingPayments = await dbManager.query('finance_payments', {
      select: 'payment_number',
      eq: { finance_id: financeId },
      order: { payment_number: 'desc' }
    });

    const nextPaymentNumber = existingPayments && existingPayments.length > 0 ?
      existingPayments[0].payment_number + 1 : 1;

    // Record payment in finance_payments table
    const paymentData = {
      id: uuidv4(),
      finance_id: financeId,
      payment_number: nextPaymentNumber,
      due_date: new Date().toISOString().split('T')[0],
      amount_due: amount,
      amount_paid: amount,
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: paymentMethod,
      status: 'paid',
      notes: notes
    };

    await dbManager.insert('finance_payments', [paymentData]);

    // Update finance agreement
    const newTotalPaid = (parseFloat(agreement.total_paid) || 0) + parseFloat(amount);
    const newRemainingBalance = (parseFloat(agreement.remaining_balance) || parseFloat(agreement.total_amount)) - parseFloat(amount);

    // Calculate next payment date
    const nextPaymentDate = calculateNextPaymentDate(
      new Date(),
      agreement.payment_frequency || 'monthly',
      1
    );

    const updateData = {
      total_paid: newTotalPaid,
      remaining_balance: Math.max(0, newRemainingBalance),
      next_payment_date: nextPaymentDate.toISOString().split('T')[0],
      updated_at: new Date().toISOString()
    };

    // Update status to completed if fully paid
    if (newRemainingBalance <= 0) {
      updateData.status = 'completed';
    }

    await dbManager.update('finance', updateData, { id: financeId });

    // Get updated agreement with lead info
    const updatedAgreementResult = await dbManager.query('finance', {
      select: `
        *,
        leads!inner(name, email, phone)
      `,
      eq: { id: financeId }
    });

    const updatedAgreement = updatedAgreementResult[0];
    if (updatedAgreement && updatedAgreement.leads) {
      updatedAgreement.lead_name = updatedAgreement.leads.name;
      updatedAgreement.lead_email = updatedAgreement.leads.email;
      updatedAgreement.lead_phone = updatedAgreement.leads.phone;
      delete updatedAgreement.leads;
    }

    res.status(201).json({
      message: 'Payment recorded successfully',
      payment: paymentData,
      agreement: updatedAgreement
    });

  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/finance/due-payments
// @desc    Get payments due for reminders
// @access  Private
router.get('/due-payments', auth, async (req, res) => {
  try {
    // Get active finance agreements due within next 7 days
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const activeAgreements = await dbManager.query('finance', {
      select: `
        id, lead_id, sale_id, total_amount, deposit_amount, monthly_payment,
        term_months, interest_rate, start_date, status, remaining_balance,
        agreement_number, total_paid, created_at, next_payment_date
      `,
      eq: { status: 'active' },
      lte: { next_payment_date: sevenDaysFromNow.toISOString().split('T')[0] }
    });

    // Filter for agreements with remaining balance > 0
    const dueAgreements = (activeAgreements || []).filter(agreement =>
      parseFloat(agreement.remaining_balance) > 0
    );

    // Get lead details for each agreement
    const dueAgreementsWithDetails = await Promise.all(
      dueAgreements.map(async (agreement) => {
        const leadResult = await dbManager.query('leads', {
          select: 'name, email, phone',
          eq: { id: agreement.lead_id }
        });

        return {
          ...agreement,
          lead_name: leadResult?.[0]?.name || 'Unknown',
          lead_email: leadResult?.[0]?.email || '',
          lead_phone: leadResult?.[0]?.phone || ''
        };
      })
    );

    res.json(dueAgreementsWithDetails);

  } catch (error) {
    console.error('Error fetching due payments:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/finance/send-reminder
// @desc    Send payment reminder
// @access  Private
router.post('/send-reminder', auth, async (req, res) => {
  try {
    const { financeId, reminderType = 'email' } = req.body;

    if (!financeId) {
      return res.status(400).json({ message: 'Finance ID is required' });
    }

    // Get finance agreement with lead info
    const agreementResult = await dbManager.query('finance', {
      select: `
        *,
        leads!inner(name, email, phone)
      `,
      eq: { id: financeId }
    });

    if (!agreementResult || agreementResult.length === 0) {
      return res.status(404).json({ message: 'Finance agreement not found' });
    }

    const agreement = agreementResult[0];
    const leadInfo = agreement.leads;

    // TODO: Actually send email/SMS here
    // For now, just log the reminder
    console.log(`📧 Payment reminder ${reminderType} sent for agreement ${agreement.agreement_number} to ${leadInfo.name}`);

    res.json({
      message: `${reminderType.toUpperCase()} reminder sent successfully`,
      reminder: {
        finance_id: financeId,
        reminder_type: reminderType,
        sent_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error sending reminder:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/finance/overdue
// @desc    Get overdue payments
// @access  Private
router.get('/overdue', auth, async (req, res) => {
  try {
    // Get active finance agreements past due date
    const today = new Date().toISOString().split('T')[0];

    const activeAgreements = await dbManager.query('finance', {
      select: `
        id, lead_id, sale_id, total_amount, deposit_amount, monthly_payment,
        term_months, interest_rate, start_date, status, remaining_balance,
        agreement_number, total_paid, created_at, next_payment_date
      `,
      eq: { status: 'active' },
      lt: { next_payment_date: today }
    });

    // Filter for agreements with remaining balance > 0
    const overdueAgreements = (activeAgreements || []).filter(agreement =>
      parseFloat(agreement.remaining_balance) > 0
    );

    // Get lead details for each agreement
    const overdueAgreementsWithDetails = await Promise.all(
      overdueAgreements.map(async (agreement) => {
        const leadResult = await dbManager.query('leads', {
          select: 'name, email, phone',
          eq: { id: agreement.lead_id }
        });

        return {
          ...agreement,
          lead_name: leadResult?.[0]?.name || 'Unknown',
          lead_email: leadResult?.[0]?.email || '',
          lead_phone: leadResult?.[0]?.phone || ''
        };
      })
    );

    res.json(overdueAgreementsWithDetails);

  } catch (error) {
    console.error('Error fetching overdue payments:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/finance/stats
// @desc    Get finance statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    // Get all finance agreements for calculations
    const allAgreements = await dbManager.query('finance', {
      select: 'status, total_amount, total_paid, remaining_balance, monthly_payment'
    });

    // Calculate statistics
    const stats = {
      total_agreements: allAgreements?.length || 0,
      active_agreements: allAgreements?.filter(a => a.status === 'active').length || 0,
      completed_agreements: allAgreements?.filter(a => a.status === 'completed').length || 0,
      defaulted_agreements: allAgreements?.filter(a => a.status === 'defaulted').length || 0,
      total_financed: allAgreements?.reduce((sum, a) => sum + (parseFloat(a.total_amount) || 0), 0) || 0,
      total_collected: allAgreements?.reduce((sum, a) => sum + (parseFloat(a.total_paid) || 0), 0) || 0,
      total_outstanding: allAgreements?.reduce((sum, a) => sum + (parseFloat(a.remaining_balance) || 0), 0) || 0,
      avg_payment_amount: allAgreements?.length > 0 ?
        allAgreements.reduce((sum, a) => sum + (parseFloat(a.monthly_payment) || 0), 0) / allAgreements.length : 0
    };

    // Calculate monthly stats (simplified - we'll use active agreements as due)
    const activeAgreements = allAgreements?.filter(a => a.status === 'active') || [];
    const monthlyStats = {
      agreements_due_this_month: activeAgreements.length,
      total_due_this_month: activeAgreements.reduce((sum, a) => sum + (parseFloat(a.monthly_payment) || 0), 0)
    };

    res.json({
      ...stats,
      ...monthlyStats
    });

  } catch (error) {
    console.error('Error fetching finance stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 