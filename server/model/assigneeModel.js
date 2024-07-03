const mongoose = require('mongoose');

const assigneeSchema = new mongoose.Schema({
  email: {
    type: String,
    validate: {
      validator: function (val) {
        return /^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(val);
      },
      message: (props) => `${props.value} is not a valid email!`,
    },
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
});

const Assignee = mongoose.model('Assignee', assigneeSchema);

module.exports = Assignee;
