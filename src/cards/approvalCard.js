/**
 * Generate Adaptive Card for ticket approval
 */
function createApprovalCard(ticket) {
  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'Container',
        style: 'emphasis',
        items: [
          {
            type: 'ColumnSet',
            columns: [
              {
                type: 'Column',
                width: 'auto',
                items: [
                  {
                    type: 'Image',
                    url: 'https://adaptivecards.io/content/pending.png',
                    size: 'Small',
                    style: 'Person'
                  }
                ]
              },
              {
                type: 'Column',
                width: 'stretch',
                items: [
                  {
                    type: 'TextBlock',
                    text: '🎫 New Approval Request',
                    weight: 'Bolder',
                    size: 'Large',
                    wrap: true
                  },
                  {
                    type: 'TextBlock',
                    text: `Ticket ID: ${ticket.ticket_id}`,
                    isSubtle: true,
                    spacing: 'None',
                    size: 'Small'
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        type: 'Container',
        spacing: 'Medium',
        separator: true,
        items: [
          {
            type: 'FactSet',
            facts: [
              {
                title: 'Title:',
                value: ticket.title
              },
              {
                title: 'Type:',
                value: ticket.ticket_type
              },
              {
                title: 'Priority:',
                value: ticket.priority
              },
              {
                title: 'Created By:',
                value: ticket.created_by_name
              },
              {
                title: 'Created On:',
                value: new Date(ticket.created_at).toLocaleString()
              }
            ]
          }
        ]
      },
      {
        type: 'Container',
        spacing: 'Medium',
        items: [
          {
            type: 'TextBlock',
            text: 'Description',
            weight: 'Bolder',
            size: 'Medium'
          },
          {
            type: 'TextBlock',
            text: ticket.description,
            wrap: true,
            spacing: 'Small'
          }
        ]
      },
      {
        type: 'Container',
        spacing: 'Medium',
        id: 'rejectionReasonContainer',
        isVisible: false,
        items: [
          {
            type: 'TextBlock',
            text: 'Rejection Reason (Optional)',
            weight: 'Bolder'
          },
          {
            type: 'Input.Text',
            id: 'rejectionReason',
            placeholder: 'Enter reason for rejection...',
            isMultiline: true,
            maxLength: 500
          }
        ]
      }
    ],
    actions: [
      {
        type: 'Action.Execute',
        title: '✅ Approve',
        verb: 'approve',
        style: 'positive',
        data: {
          ticketId: ticket.ticket_id,
          action: 'approve'
        }
      },
      {
        type: 'Action.ToggleVisibility',
        title: '❌ Reject',
        targetElements: ['rejectionReasonContainer', 'submitRejection']
      },
      {
        type: 'Action.Execute',
        title: 'Submit Rejection',
        verb: 'reject',
        style: 'destructive',
        id: 'submitRejection',
        isVisible: false,
        data: {
          ticketId: ticket.ticket_id,
          action: 'reject'
        }
      }
    ]
  };

  return card;
}

/**
 * Generate Adaptive Card for approved ticket
 */
function createApprovedCard(ticket, approver) {
  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'Container',
        style: 'good',
        items: [
          {
            type: 'ColumnSet',
            columns: [
              {
                type: 'Column',
                width: 'auto',
                items: [
                  {
                    type: 'Image',
                    url: 'https://adaptivecards.io/content/success.png',
                    size: 'Small'
                  }
                ]
              },
              {
                type: 'Column',
                width: 'stretch',
                items: [
                  {
                    type: 'TextBlock',
                    text: '✅ Ticket Approved',
                    weight: 'Bolder',
                    size: 'Large',
                    color: 'Good',
                    wrap: true
                  },
                  {
                    type: 'TextBlock',
                    text: `Ticket ID: ${ticket.ticket_id}`,
                    isSubtle: true,
                    spacing: 'None',
                    size: 'Small'
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        type: 'Container',
        spacing: 'Medium',
        separator: true,
        items: [
          {
            type: 'FactSet',
            facts: [
              {
                title: 'Title:',
                value: ticket.title
              },
              {
                title: 'Type:',
                value: ticket.ticket_type
              },
              {
                title: 'Approved By:',
                value: approver.name
              },
              {
                title: 'Approved On:',
                value: new Date().toLocaleString()
              }
            ]
          }
        ]
      }
    ]
  };

  return card;
}

/**
 * Generate Adaptive Card for rejected ticket
 */
function createRejectedCard(ticket, rejector, rejectionReason) {
  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'Container',
        style: 'attention',
        items: [
          {
            type: 'ColumnSet',
            columns: [
              {
                type: 'Column',
                width: 'auto',
                items: [
                  {
                    type: 'Image',
                    url: 'https://adaptivecards.io/content/error.png',
                    size: 'Small'
                  }
                ]
              },
              {
                type: 'Column',
                width: 'stretch',
                items: [
                  {
                    type: 'TextBlock',
                    text: '❌ Ticket Rejected',
                    weight: 'Bolder',
                    size: 'Large',
                    color: 'Attention',
                    wrap: true
                  },
                  {
                    type: 'TextBlock',
                    text: `Ticket ID: ${ticket.ticket_id}`,
                    isSubtle: true,
                    spacing: 'None',
                    size: 'Small'
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        type: 'Container',
        spacing: 'Medium',
        separator: true,
        items: [
          {
            type: 'FactSet',
            facts: [
              {
                title: 'Title:',
                value: ticket.title
              },
              {
                title: 'Type:',
                value: ticket.ticket_type
              },
              {
                title: 'Rejected By:',
                value: rejector.name
              },
              {
                title: 'Rejected On:',
                value: new Date().toLocaleString()
              }
            ]
          }
        ]
      }
    ]
  };

  // Add rejection reason if provided
  if (rejectionReason) {
    card.body.push({
      type: 'Container',
      spacing: 'Medium',
      separator: true,
      items: [
        {
          type: 'TextBlock',
          text: 'Rejection Reason',
          weight: 'Bolder'
        },
        {
          type: 'TextBlock',
          text: rejectionReason,
          wrap: true,
          spacing: 'Small'
        }
      ]
    });
  }

  return card;
}

/**
 * Generate notification card for ticket creator
 */
function createNotificationCard(ticket, status, actionBy, rejectionReason = null) {
  const isApproved = status === 'Approved';
  const icon = isApproved ? '✅' : '❌';
  const statusText = isApproved ? 'Approved' : 'Rejected';
  const style = isApproved ? 'good' : 'attention';
  const color = isApproved ? 'Good' : 'Attention';

  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'Container',
        style: style,
        items: [
          {
            type: 'TextBlock',
            text: `${icon} Your Ticket Has Been ${statusText}`,
            weight: 'Bolder',
            size: 'Large',
            color: color,
            wrap: true
          }
        ]
      },
      {
        type: 'Container',
        spacing: 'Medium',
        separator: true,
        items: [
          {
            type: 'FactSet',
            facts: [
              {
                title: 'Ticket ID:',
                value: ticket.ticket_id
              },
              {
                title: 'Title:',
                value: ticket.title
              },
              {
                title: `${statusText} By:`,
                value: actionBy.name
              },
              {
                title: 'Date:',
                value: new Date().toLocaleString()
              }
            ]
          }
        ]
      }
    ]
  };

  // Add rejection reason if provided
  if (rejectionReason) {
    card.body.push({
      type: 'Container',
      spacing: 'Medium',
      separator: true,
      items: [
        {
          type: 'TextBlock',
          text: 'Rejection Reason',
          weight: 'Bolder'
        },
        {
          type: 'TextBlock',
          text: rejectionReason,
          wrap: true,
          spacing: 'Small'
        }
      ]
    });
  }

  return card;
}

module.exports = {
  createApprovalCard,
  createApprovedCard,
  createRejectedCard,
  createNotificationCard
};
