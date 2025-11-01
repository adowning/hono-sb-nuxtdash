<template>
  <ArtResultPage
    type="success"
    title="Submission successful"
    message="The submission result page is used to feedback the processing results of a series of operation tasks. If it is only a simple operation, use the Message global prompt feedback. The gray area can display some supplementary information."
    iconCode="&#xe617;"
  >
    <template #content>
      <p>The application has been submitted and is awaiting review by the department. </p>
    </template>
    <template #buttons>
      <el-button type="primary" v-ripple>Return to modification</el-button>
      <el-button v-ripple>View</el-button>
      <el-button v-ripple>Print</el-button>
    </template>
  </ArtResultPage>
</template>

<script setup lang="ts">
  defineOptions({ name: 'ResultSuccess' })
</script>
