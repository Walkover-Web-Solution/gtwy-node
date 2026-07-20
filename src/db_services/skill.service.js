import Skill from "../mongoModel/Skill.model.js";

const createSkill = async (data) => {
  try {
    const skill = await Skill.create(data);
    return {
      success: true,
      result: skill
    };
  } catch (error) {
    console.error("Error creating skill:", error);
    return {
      success: false,
      error: error.message
    };
  }
};

const getSkillsByOrg = async (org_id) => {
  try {
    const skills = await Skill.find({ org_id, deletedAt: null }, { _id: 1, name: 1, description: 1, createdAt: 1, updatedAt: 1 }).sort({
      createdAt: -1
    });

    return {
      success: true,
      result: skills
    };
  } catch (error) {
    console.error("Error getting skills by org:", error);
    return {
      success: false,
      error: error.message
    };
  }
};

const getSkillById = async (id, org_id) => {
  try {
    const skill = await Skill.findOne({ _id: id, org_id, deletedAt: null });

    if (!skill) {
      return {
        success: false,
        error: "Skill not found"
      };
    }

    return {
      success: true,
      result: skill
    };
  } catch (error) {
    console.error("Error getting skill by id:", error);
    return {
      success: false,
      error: error.message
    };
  }
};

const updateSkill = async (id, org_id, updateData) => {
  try {
    const skill = await Skill.findOneAndUpdate({ _id: id, org_id, deletedAt: null }, updateData, { new: true });

    if (!skill) {
      return {
        success: false,
        error: "Skill not found"
      };
    }

    return {
      success: true,
      result: skill
    };
  } catch (error) {
    console.error("Error updating skill:", error);
    return {
      success: false,
      error: error.message
    };
  }
};

const deleteSkill = async (id, org_id) => {
  try {
    const skill = await Skill.findOneAndUpdate({ _id: id, org_id, deletedAt: null }, { deletedAt: new Date() }, { new: true });

    if (!skill) {
      return {
        success: false,
        error: "Skill not found"
      };
    }

    return {
      success: true,
      result: skill
    };
  } catch (error) {
    console.error("Error deleting skill:", error);
    return {
      success: false,
      error: error.message
    };
  }
};

export { createSkill, getSkillsByOrg, getSkillById, updateSkill, deleteSkill };
